export interface Settings {
  localstack: { protocol: string; host: string; port: number };
  aws: { accessKeyId: string; secretAccessKey: string; region: string };
  cleanup: { ttlMinutes: number };
}

export const DEFAULTS: Settings = {
  localstack: { protocol: "http", host: "localhost", port: 4566 },
  aws: { accessKeyId: "test", secretAccessKey: "test", region: "us-east-1" },
  cleanup: { ttlMinutes: 1440 },
};

export interface BuildMeta {
  id: string;
  projectPath: string;
  buildTool: string;
  handler: string;
  jarPath: string;
  createdAt: string;
  projectName: string;
}

export interface Deployment {
  functionName: string;
  handler: string;
  runtime: string;
  action: string;
  buildId: string;
  projectName: string;
  projectPath: string;
  buildTime: string;
  deployedAt: string;
  status: string;
}
