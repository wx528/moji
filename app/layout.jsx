import "./globals.css";
import { MojiDialogHost } from "./moji-dialog";

export const metadata = {
  title: "墨迹写作 MoJi",
  description: "无拘创作，深邃而平静的写作空间",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('moji-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <MojiDialogHost />
      </body>
    </html>
  );
}
