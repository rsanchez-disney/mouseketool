// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) =>
  s.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, "").replace(/\[[\d;]*[mK]/g, "").replace(/[\x1b\r]/g, "");
