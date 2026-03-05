import { type ParentProps } from "solid-js";
import Sidebar from "./components/Sidebar";
import { PRDataProvider } from "./PRDataContext";
import "./App.css";

function App(props: ParentProps) {
  return (
    <PRDataProvider>
      <div class="flex h-screen bg-gray-950 text-gray-100">
        <Sidebar />
        <main class="flex-1 overflow-y-auto p-3">{props.children}</main>
      </div>
    </PRDataProvider>
  );
}

export default App;
