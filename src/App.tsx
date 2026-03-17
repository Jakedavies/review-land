import { type ParentProps, createEffect } from "solid-js";
import { useLocation } from "@solidjs/router";
import Sidebar from "./components/Sidebar";
import { PRDataProvider } from "./PRDataContext";
import "./App.css";

function App(props: ParentProps) {
  const location = useLocation();
  let mainRef: HTMLElement | undefined;

  createEffect(() => {
    location.pathname; // track route changes
    mainRef?.scrollTo(0, 0);
  });

  return (
    <PRDataProvider>
      <div class="flex h-screen bg-gray-950 text-gray-100">
        <Sidebar />
        <main ref={mainRef} class="flex-1 overflow-y-auto p-3">{props.children}</main>
      </div>
    </PRDataProvider>
  );
}

export default App;
