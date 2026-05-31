import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, X, Image as ImageIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type FrqAnswerState = {
  text: string;
  fileUrl: string | null;
  fileKind: "image" | "pdf" | "doc" | "text" | null;
  fileName: string | null;
};

export const EMPTY_ANSWER: FrqAnswerState = {
  text: "",
  fileUrl: null,
  fileKind: null,
  fileName: null,
};

export function FrqAnswerBox({
  paperId,
  frqId,
  value,
  onChange,
  disabled,
}: {
  paperId: string;
  frqId: string;
  value: FrqAnswerState;
  onChange: (v: FrqAnswerState) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("请先登录");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("paper_id", paperId);
      fd.append("frq_id", frqId);
      const r = await fetch("/api/frq/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error || "上传失败");
        return;
      }
      const j = (await r.json()) as { url: string; kind: FrqAnswerState["fileKind"] };
      onChange({ ...value, fileUrl: j.url, fileKind: j.kind, fileName: file.name });
      toast.success("文件已上传");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3 border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">你的答案</h4>
        <span className="text-xs text-muted-foreground">支持打字、上传图片或文件（图片优先）</span>
      </div>
      <Textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="在此输入文字答案（也可只上传手写答案图片）"
        rows={6}
        disabled={disabled}
        className="font-mono text-sm"
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          上传图片/文件
        </Button>
        {value.fileUrl && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground border rounded px-2 py-1">
            {value.fileKind === "image" ? (
              <ImageIcon className="h-3.5 w-3.5" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <a href={value.fileUrl} target="_blank" rel="noreferrer" className="underline max-w-[180px] truncate">
              {value.fileName ?? "已上传"}
            </a>
            <button
              type="button"
              onClick={() => onChange({ ...value, fileUrl: null, fileKind: null, fileName: null })}
              className="text-muted-foreground hover:text-foreground"
              disabled={disabled}
              aria-label="移除文件"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {value.fileUrl && value.fileKind === "image" && (
        <img
          src={value.fileUrl}
          alt="作答图片"
          className="max-h-48 rounded border border-border object-contain"
        />
      )}
    </div>
  );
}