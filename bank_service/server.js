// bank-service/server.js
const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4002;
const DELAY_MS = parseInt(process.env.DELAY_MS || '0', 10);
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0');
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');

// Bảng thống kê hệ thống
const stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0
};

// Bộ nhớ Idempotency: idempotencyKey -> { status, body }
const transactionCache = new Map();
// Tập hợp các reference đã được tính tiền
const chargedReferences = new Set();

app.post('/charges', async (req, res) => {
  stats.requests++;
  const idempotencyKey = req.header('Idempotency-Key');
  const { reference, amount } = req.body;

  // 1. Kiểm tra Idempotency trước
  if (idempotencyKey && transactionCache.has(idempotencyKey)) {
    const cached = transactionCache.get(idempotencyKey);
    // Trả lại nguyên vẹn kết quả trước đó, KHÔNG tăng charges, KHÔNG trừ trùng
    return res.status(cached.status).json(cached.body);
  }

  // 2. Mô phỏng trễ (Tình huống 2)
  if (DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  // 3. Mô phỏng lỗi 500 trước khi trừ tiền (Tình huống 4b)
  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    return res.status(500).json({ error: "Internal Server Error (Simulated transient failure)" });
  }

  // 4. Kiểm tra hợp lệ nghiệp vụ
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  // 5. Kiểm tra hạn mức 20.000.000đ (Tình huống 4c)
  if (amount > 20000000) {
    const errorBody = { error: "Amount exceeds transaction limit of 20,000,000 VND" };
    if (idempotencyKey) {
      transactionCache.set(idempotencyKey, { status: 402, body: errorBody });
    }
    return res.status(402).json(errorBody);
  }

  // 6. Thực hiện trừ tiền
  if (chargedReferences.has(reference)) {
    stats.duplicates++;
  } else {
    chargedReferences.add(reference);
  }
  stats.charges++;

  const successBody = {
    chargeId: `CHG_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    reference,
    amount,
    status: "SUCCESS"
  };

  // Lưu cache giao dịch theo Idempotency-Key
  if (idempotencyKey) {
    transactionCache.set(idempotencyKey, { status: 201, body: successBody });
  }

  // 7. Mô phỏng đứt kết nối sau khi đã trừ tiền (Tình huống 4a)
  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    console.log(`[BANK] Ngắt socket bất ngờ sau khi trừ tiền thành công: ${reference}`);
    return req.socket.destroy(); // Hủy kết nối TCP đột ngột
  }

  return res.status(201).json(successBody);
});

// Endpoint xem thống kê
app.get('/stats', (req, res) => {
  res.json(stats);
});

// Endpoint reset thống kê khi test giữa các kịch bản
app.post('/stats/reset', (req, res) => {
  stats.connections = 0;
  stats.requests = 0;
  stats.charges = 0;
  stats.duplicates = 0;
  transactionCache.clear();
  chargedReferences.clear();
  res.json({ message: "Reset stats successfully", stats });
});

const server = http.createServer(app);

// Đếm kết nối TCP mới & in log
server.on('connection', (socket) => {
  stats.connections++;
  console.log(`[BANK] TCP connection mới được mở (Tổng connections: ${stats.connections})`);
});

// Giữ kết nối nhàn rỗi tối đa 5 giây theo yêu cầu đề bài
server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;

server.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(` Bank Service running on port ${PORT}`);
  console.log(` DELAY_MS=${DELAY_MS} | FAIL_RATE=${FAIL_RATE} | DROP_RATE=${DROP_RATE}`);
  console.log(`==========================================`);
});