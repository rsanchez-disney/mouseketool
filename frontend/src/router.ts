import { createRouter, createWebHistory } from "vue-router";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/builder" },
    { path: "/builder", component: () => import("./pages/BuilderPage.vue") },
    { path: "/deployments", component: () => import("./pages/DeploymentsPage.vue") },
    { path: "/settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/help", component: () => import("./pages/HelpPage.vue") },
  ],
});
