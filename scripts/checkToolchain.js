// @ts-check
const expectedNode = "24.15.0",
  expectedNpm = "11.6.1";
const npmVersion =
  process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1];
console.log(
  JSON.stringify({
    node: process.versions.node,
    npm: npmVersion,
    platform: process.platform,
    arch: process.arch,
  }),
);
if (process.versions.node !== expectedNode || npmVersion !== expectedNpm) {
  throw new Error(
    `Use Node ${expectedNode} and npm ${expectedNpm}; run this check with npm run toolchain:check.`,
  );
}
