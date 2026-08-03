import { useState, type ReactNode } from "react";
import { Loader2, QrCode, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PAY_PLANS, amountFor, membershipDaysFor, normalizeQuantity, type PayPlanKey } from "@/lib/pay-plans";
import { ALIPAY_QR, PAY_ACCOUNT_NAME, WECHAT_QR } from "@/lib/pay-qr";

type Channel = "wechat" | "alipay";

export function ManualPayDialog({ planKey, trigger }: { planKey: PayPlanKey; trigger: ReactNode }) {
  const { user } = useAuth();
  const plan = PAY_PLANS[planKey];
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("wechat");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const qty = normalizeQuantity(plan, quantity);
  const amount = amountFor(plan, qty);
  const giftDays = membershipDaysFor(plan, qty);
  const qr = channel === "wechat" ? WECHAT_QR : ALIPAY_QR;

  async function submit() {
    if (!user) return toast.error("请先登录");
    if (!file) return toast.error("请上传付款截图，方便我们核对");
    setSubmitting(true);
    try {
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase().slice(0, 5);
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const upload = await supabase.storage.from("payment-proofs").upload(path, file, { contentType: file.type || "image/png" });
      if (upload.error) throw upload.error;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/manual-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ planKey, quantity: qty, channel, proofPath: path, payerNote: note.trim() || null }),
      });
      if (!response.ok) throw new Error("submit failed");
      const result = (await response.json()) as { orderNo: string };
      setOpen(false);
      setFile(null);
      setNote("");
      toast.success(`已提交（订单号 ${result.orderNo}），我们会尽快为你开通，可在“我的订单”查看进度`);
    } catch (error) {
      console.error("Manual payment submit failed", error);
      toast.error("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan.label} · 扫码付款</DialogTitle>
        </DialogHeader>

        {!user ? (
          <p className="text-sm text-muted-foreground">请先登录后再购买。</p>
        ) : (
          <div className="space-y-4">
            {plan.allowQuantity && (
              <div className="space-y-2">
                <Label htmlFor="pay-qty">节数（1 – {plan.maxQuantity ?? 20}）</Label>
                <Input id="pay-qty" type="number" min={1} max={plan.maxQuantity ?? 20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
              </div>
            )}

            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span>应付金额</span>
                <span className="text-lg font-bold">¥{amount}</span>
              </div>
              {giftDays > 0 && <p className="mt-1 text-xs text-primary">🎁 开通后赠送 Pro 会员 {giftDays} 天</p>}
            </div>

            <div className="space-y-2">
              <Label>付款方式</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={channel === "wechat" ? "default" : "outline"} onClick={() => setChannel("wechat")}>微信支付</Button>
                <Button type="button" variant={channel === "alipay" ? "default" : "outline"} onClick={() => setChannel("alipay")}>支付宝</Button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
              {qr ? (
                <img src={qr} alt={channel === "wechat" ? "微信收款码" : "支付宝收款码"} className="h-52 w-52 object-contain" />
              ) : (
                <div className="flex h-52 w-52 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center text-xs text-muted-foreground">
                  <QrCode className="h-8 w-8" />
                  收款码尚未配置，请通过反馈联系我们获取
                </div>
              )}
              <p className="text-xs text-muted-foreground">收款人：{PAY_ACCOUNT_NAME}｜请按上方金额付款</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-proof">上传付款截图</Label>
              <Input id="pay-proof" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-note">备注（选填）</Label>
              <Textarea id="pay-note" rows={2} placeholder="付款账号后四位 / 联系方式等" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
            </div>

            <p className="text-xs text-muted-foreground">提交后我们会人工核对，通常 24 小时内为你开通权益。</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={!user || submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            我已付款，提交审核
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}