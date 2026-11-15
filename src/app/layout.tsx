import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MD Publisher — Markdown DTP & PDF Publishing",
  description:
    "Markdown執筆・YAMLフロントマター制御・Paged.js組版プレビュー対応のパブリッシングWebアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
