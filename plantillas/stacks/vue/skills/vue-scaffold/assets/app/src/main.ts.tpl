// App entry point (orchestrator zone): creates the app, installs the router and mounts it on #app.
import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { router } from "./router";

createApp(App).use(router).mount("#app");
