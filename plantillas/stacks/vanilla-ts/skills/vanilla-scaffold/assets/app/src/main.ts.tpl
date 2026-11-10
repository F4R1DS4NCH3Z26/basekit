// Entry point (orchestrator zone): global styles and the router mounted on #app (index.html).
import "./style.css";
import { startRouter } from "./lib/router";
import { notFoundPage, routes } from "./routes";

const outlet = document.querySelector<HTMLElement>("#app");
if (!outlet) throw new Error("index.html no tiene #app");
startRouter(outlet, routes, notFoundPage);
