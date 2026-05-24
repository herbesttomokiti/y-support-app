import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Loader2, ClipboardList, Settings, LogIn, ArrowLeft, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Screen = "top" | "login";

export default function Home() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [screen, setScreen] = useState<Screen>("top");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate("/admin");
    },
    onError: (err) => {
      toast.error(err.message || "ログインに失敗しました");
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("メールアドレスとパスワードを入力してください");
      return;
    }
    loginMutation.mutate({ email, password });
  };

  // ── ローディング ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── ログイン画面 ──────────────────────────────────────────────────────
  if (screen === "login") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-3">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <ClipboardList className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">he/rbest作業アプリ</h1>
            <p className="text-muted-foreground text-sm">管理者ログイン</p>
          </div>

          <Card className="rounded-2xl border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base text-center">ログイン</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="info@herbest.biz"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="rounded-xl"
                    disabled={loginMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">パスワード</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="パスワードを入力"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="rounded-xl"
                    disabled={loginMutation.isPending}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full h-12 text-base font-medium rounded-xl"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  ) : (
                    <LogIn className="w-5 h-5 mr-2" />
                  )}
                  ログイン
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="text-center">
            <button
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors flex items-center gap-1 mx-auto"
              onClick={() => setScreen("top")}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              トップに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── TOPページ：常に2ボタン構成（ログイン状態に関わらず） ──────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-10">
        {/* ロゴ・タイトル */}
        <div className="text-center space-y-3">
          <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto shadow-sm">
            <ClipboardList className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">he/rbest</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">作業アプリ</p>
        </div>

        {/* 2ボタン */}
        <div className="space-y-4">
          {/* 管理者ボタン：ログイン済みなら直接管理者メニューへ、未ログインならログイン画面へ */}
          <button
            className="w-full group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
            onClick={() => {
              if (user) {
                navigate("/admin");
              } else {
                setScreen("login");
              }
            }}
          >
            <div className="flex items-center gap-4 px-6 py-5">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-colors">
                <Settings className="w-6 h-6 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-base font-bold text-foreground">管理者メニュー</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {user ? `ログイン中：${user.name ?? "管理者"}` : "作業カードの作成・管理"}
                </p>
              </div>
            </div>
          </button>

          {/* 作業者ボタン */}
          <button
            className="w-full group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
            onClick={() => navigate("/tasks")}
          >
            <div className="flex items-center gap-4 px-6 py-5">
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-green-500/15 transition-colors">
                <User className="w-6 h-6 text-green-600" />
              </div>
              <div className="text-left">
                <p className="text-base font-bold text-foreground">今日の作業</p>
                <p className="text-xs text-muted-foreground mt-0.5">作業カードを確認して始める</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
