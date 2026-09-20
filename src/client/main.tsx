import { render } from "@solidjs/web";
import { Errored } from "solid-js";
import { App } from "./app";
import "./styles/app.css";
import "./styles/replay.css";

render(() => (
  <Errored fallback={(error, reset) => <main class="fatal-error"><h1>Something interrupted the replay.</h1><p>{String(error())}</p><button onClick={reset}>Try again</button></main>}>
    <App />
  </Errored>
), document.getElementById("app")!);
