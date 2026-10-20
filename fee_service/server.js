// fee-service/server.js
const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = 4001;
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

// Cấu hình Connection Pool & Keep-Alive cho HTTP Client
const bankAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,
  keepAliveMsecs: 4000 // Giữ kết nối 4s (thấp hơn 5s của server để tránh socket đóng bất ngờ)
});

// Dữ liệu sinh viên trong bộ nhớ
const students = {
  1: { debt: 50000000 },
  2: { debt: 0 },
  3: { debt: 3200000 },
  4: {debt: 1700000},
  5: {debt: 6000000}
};

let paymentSeq = 1;

// 1. GET /students/:id/fees
app.get('/students/:id/fees', (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  return res.status(200).json({
    studentId: parseInt(req.params.id),
    debt: student.debt
  });
});

// Helper: Gọi sang Bank với AbortController (Timeout 4000ms <= 4.5s)
async function sendChargeRequest(paymentId, amount, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BANK_URL}/charges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': paymentId
      },
      body: JSON.stringify({
        reference: paymentId,
        amount: amount
      }),
      agent: bankAgent,
      signal: controller.signal
    });
    clearTimeout(timer);

    const body = await response.json().catch(() => ({}));
    return { ok: true, status: response.status, body };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err };
  }
}

// POST /students/:id/payments trong fee-service/server.js
app.post('/students/:id/payments', async (req, res) => {
  const studentId = req.params.id;
  const { amount } = req.body;
  const student = students[studentId];

  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid payment amount" });
  }
  if (amount > student.debt) {
    return res.status(400).json({ error: "Amount exceeds current debt" });
  }

  const paymentId = `P${paymentSeq++}`;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Timeout đặt 4000ms (< 4.5s theo đúng yêu cầu đề bài)
    const resResult = await sendChargeRequest(paymentId, amount, 4000);

    if (resResult.ok) {
      const { status, body } = resResult;

      if (status === 201) {
        student.debt -= amount;
        return res.status(201).json({
          paymentId,
          status: "PAID",
          debtRemaining: student.debt,
          chargeId: body.chargeId
        });
      }

      // Ngân hàng từ chối rõ ràng (400, 402) -> Không retry
      if (status >= 400 && status < 500) {
        return res.status(status).json({
          paymentId,
          error: body.error || "Payment rejected by bank",
          status: "FAILED"
        });
      }

      // Lỗi 500 tạm thời (Tình huống 4b) -> Retry
      if (status >= 500 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      return res.status(504).json({
        paymentId,
        error: "Bank transient failure",
        status: "PENDING"
      });
    }

    const err = resResult.error;

    // 1. TÌNH HUỐNG 1: Ngân hàng tắt hẳn -> Trả 503 ngay lập tức
    if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        paymentId,
        error: "Cannot connect to Bank Service",
        status: "FAILED"
      });
    }

    // 2. TÌNH HUỐNG 2: Timeout do quá 4 giây -> KHÔNG RETRY, trả ngay 504 PENDING (< 4.5s)
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      return res.status(504).json({
        paymentId,
        error: "Bank response timeout",
        status: "PENDING"
      });
    }

    // 3. TÌNH HUỐNG 4a: Đứt kết nối socket giữa chừng -> Thử lại với cùng Idempotency-Key
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    return res.status(504).json({
      paymentId,
      error: "Connection reset by peer",
      status: "PENDING"
    });
  }
});

app.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(` Fee Service running on port ${PORT}`);
  console.log(` Bank Target: ${BANK_URL}`);
  console.log(`==========================================`);
});