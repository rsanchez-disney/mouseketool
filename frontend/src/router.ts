import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/HomePage.vue"), meta: { title: "Home" } },
    { path: "/builder", component: () => import("./pages/BuilderPage.vue"), meta: { title: "Builder" } },
    { path: "/deployments", component: () => import("./pages/DeploymentsPage.vue"), meta: { title: "Deployments" } },
    { path: "/projects", component: () => import("./pages/ProjectsPage.vue"), meta: { title: "Projects" } },
    { path: "/triggers", component: () => import("./pages/TriggersPage.vue"), meta: { title: "Triggers" } },
    { path: "/triggers/:id/execute", component: () => import("./pages/ExecutionPage.vue"), meta: { title: "Execution" } },
    { path: "/triggers/:id/history", component: () => import("./pages/HistoryPage.vue"), meta: { title: "History" } },
    { path: "/triggers/:id/edit", component: () => import("./pages/PipelineEditPage.vue"), meta: { title: "Pipeline Edit" } },
    { path: "/settings", component: () => import("./pages/SettingsPage.vue"), meta: { title: "Settings" } },
    { path: "/batch-projects", component: () => import("./pages/BatchProjectsPage.vue"), meta: { title: "Batch Projects" } },
    { path: "/batch-projects/:id/run", component: () => import("./pages/BatchRunPage.vue"), meta: { title: "Batch Run" } },
    { path: "/launchpad", component: () => import("./pages/LaunchpadPage.vue"), meta: { title: "Launchpad" } },
    { path: "/help", component: () => import("./pages/HelpPage.vue"), meta: { title: "Help & Guides" } },
  ],
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} — Mouseketool` : "Mouseketool";
});

export default router;
