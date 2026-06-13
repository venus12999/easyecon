import { useEffect, useState } from "react";
import { getPaddleEnvironment } from "@/lib/paddle";

export function PaymentTestModeBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(getPaddleEnvironment() === "sandbox"), []);
  if (!show) return null;
  return <div className="border-b border-warning/30 bg-warning/15 px-4 py-2 text-center text-xs text-warning-foreground">当前为测试支付，不会产生真实扣款</div>;
}