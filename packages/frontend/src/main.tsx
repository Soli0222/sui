import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
// 自己ホスト。precache を絞るため、latin と kana/漢字（japanese）サブセットのみを読み込む。
import "@fontsource/ibm-plex-sans-jp/latin-400.css";
import "@fontsource/ibm-plex-sans-jp/latin-500.css";
import "@fontsource/ibm-plex-sans-jp/latin-600.css";
import "@fontsource/ibm-plex-sans-jp/latin-700.css";
import "@fontsource/ibm-plex-sans-jp/japanese-400.css";
import "@fontsource/ibm-plex-sans-jp/japanese-500.css";
import "@fontsource/ibm-plex-sans-jp/japanese-600.css";
import "@fontsource/ibm-plex-sans-jp/japanese-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

