// test-scripts/test-scenario-4.js
async function runTestScenario4() {
  console.log("=== BẮT ĐẦU TEST TÌNH HUỐNG 4: ĐỨT KẾT NỐI / FAIL_RATE / DROP_RATE ===");
  
  await fetch("http://localhost:4002/stats/reset", { method: "POST" });

  const total = 60;
  let paidCount = 0;
  let pendingCount = 0;

  for (let i = 1; i <= total; i++) {
    const res = await fetch("http://localhost:4001/students/1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000 })
    });

    const data = await res.json();
    if (res.status === 201 && data.status === "PAID") {
      paidCount++;
    } else if (res.status === 504 && data.status === "PENDING") {
      pendingCount++;
    }
    process.stdout.write(`\rĐang chạy request: ${i}/${total} (PAID: ${paidCount}, PENDING: ${pendingCount})`);
  }

  const stats = await (await fetch("http://localhost:4002/stats")).json();
  const feeInfo = await (await fetch("http://localhost:4001/students/1/fees")).json();

  console.log(`\n\n--- KẾT QUẢ ĐO ĐẠC ---`);
  console.log(`Số lệnh PAID: ${paidCount}/${total} (Yêu cầu: >= 54)`);
  console.log(`Số lệnh PENDING (504): ${pendingCount}`);
  console.log(`Ngân hàng ghi nhận charges: ${stats.charges}`);
  console.log(`Duplicates: ${stats.duplicates} (Bắt buộc = 0)`);
  console.log(`Công nợ sinh viên còn lại: ${feeInfo.debt.toLocaleString()} đ`);
}

runTestScenario4();