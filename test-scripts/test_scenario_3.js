// test-scripts/test-scenario-3.js
async function runTestScenario3() {
  console.log("=== BẮT ĐẦU TEST TÌNH HUỐNG 3: KEEP-ALIVE ===");
  
  // Reset thống kê bank
  await fetch("http://localhost:4002/stats/reset", { method: "POST" });

  const totalRequests = 200;
  const concurrency = 10;
  let counter = 0;
  let successCount = 0;

  console.time("200_payments_time");

  async function worker() {
    while (counter < totalRequests) {
      counter++;
      try {
        const res = await fetch("http://localhost:4001/students/1/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: 1000 })
        });
        if (res.status === 201) successCount++;
      } catch (err) {
        console.error("Lỗi:", err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.timeEnd("200_payments_time");

  const statsRes = await fetch("http://localhost:4002/stats");
  const stats = await statsRes.json();

  console.log(`\n--- KẾT QUẢ ĐO ĐẠC TÌNH HUỐNG 3 ---`);
  console.log(`Số giao dịch thành công: ${successCount}/${totalRequests}`);
  console.log(`Số TCP Connections được mở: ${stats.connections} (Yêu cầu: <= 20)`);
  console.log(`Duplicates: ${stats.duplicates}`);

  console.log("\nChờ 6 giây để kết nối nhàn rỗi tự đóng...");
  await new Promise(r => setTimeout(r, 6000));

  // Gửi tiếp 1 request kiểm tra tái kết nối
  const nextRes = await fetch("http://localhost:4001/students/1/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 1000 })
  });
  console.log(`Trạng thái request sau 6s nhàn rỗi: HTTP ${nextRes.status} (Kỳ vọng: 201)`);
}

runTestScenario3();