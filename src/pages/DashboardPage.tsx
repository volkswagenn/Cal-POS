import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { ReportRepository } from '../db/repositories/ReportRepository';
import { useAsync } from '../hooks/useAsync';
import { hasApiBaseUrl } from '../services/api/client';
import { reportsApi } from '../services/api/reportsApi';
import { formatDateInput } from '../utils/date';
import { money } from '../utils/money';

export function DashboardPage() {
  const [date, setDate] = useState(formatDateInput());
  const { data: daily } = useAsync(async () => {
    if (hasApiBaseUrl && navigator.onLine) return reportsApi.daily(date);

    const [summary, hourly, products, payments, employees] = await Promise.all([
      ReportRepository.getDailySummary(date),
      ReportRepository.getHourlySales(date),
      ReportRepository.getProductSales(date),
      ReportRepository.getPaymentSummary(date),
      ReportRepository.getEmployeeSales(date),
    ]);
    return { summary, hourly, products, payments, employees };
  }, [date]);
  const summary = daily?.summary;
  const hourly = daily?.hourly;
  const products = daily?.products;
  const payments = daily?.payments;
  const employees = daily?.employees;
  const bestHour = useMemo(() => [...(hourly ?? [])].sort((a, b) => b.total - a.total)[0], [hourly]);
  const paymentRows = [
    ['เงินสด', payments?.cash ?? 0],
    ['เงินโอน', payments?.transfer ?? 0],
    ['QR', payments?.qr ?? 0],
    ['บัตรเครดิต', payments?.credit ?? 0],
  ] as const;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="แดชบอร์ด"
        subtitle="สรุปรายวัน รายชั่วโมง สินค้าขายดี ช่องทางชำระเงิน และยอดขายพนักงาน"
        action={<input type="date" className="rounded-md border-slate-300" value={date} onChange={(event) => setDate(event.target.value)} />}
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['ยอดขายสุทธิ', money(summary?.totalSales ?? 0)],
          ['จำนวนบิล', summary?.billCount ?? 0],
          ['บิลเฉลี่ย', money(summary?.averageBill ?? 0)],
          ['ส่วนลด', money(summary?.totalDiscount ?? 0)],
          ['Void', money(summary?.totalVoid ?? 0)],
          ['Refund', money(summary?.totalRefund ?? 0)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-black">{value}</div>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <div className="mb-3 flex justify-between">
            <h2 className="font-black">ยอดขายรายชั่วโมง</h2>
            <span className="text-sm text-slate-500">ช่วงขายดีที่สุด: {bestHour?.hour ?? '-'}</span>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="total" fill="#1687e8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-black">ช่องทางชำระเงิน</h2>
          {paymentRows.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-slate-100 py-2">
              <span>{label}</span>
              <b>{money(value)}</b>
            </div>
          ))}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-black">สินค้าขายดี</h2>
          {(products ?? []).slice(0, 10).map((item) => (
            <div key={item.productName} className="flex justify-between border-b border-slate-100 py-2">
              <span>{item.productName} ({item.quantity})</span>
              <b>{money(item.revenue)}</b>
            </div>
          ))}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-black">ยอดขายพนักงาน</h2>
          {(employees ?? []).map((item) => (
            <div key={item.cashierName} className="flex justify-between border-b border-slate-100 py-2">
              <span>{item.cashierName} ({item.bills} บิล)</span>
              <b>{money(item.total)}</b>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
