import { createRouter, createWebHistory } from "vue-router";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/builder" },
    { path: "/builder", component: () => import("./pages/BuilderPage.vue") },
    { path: "/deployments", component: () => import("./pages/DeploymentsPage.vue") },
    { path: "/triggers", component: () => import("./pages/TriggersPage.vue") },
    { path: "/triggers/:id/execute", component: () => import("./pages/ExecutionPage.vue") },
    { path: "/triggers/:id/history", component: () => import("./pages/HistoryPage.vue") },
    { path: "/triggers/:id/edit", component: () => import("./pages/PipelineEditPage.vue") },
    { path: "/settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/help", component: () => import("./pages/HelpPage.vue") },
  ],
});
