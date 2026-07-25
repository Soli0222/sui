import { startMockIdp } from "../../packages/backend/src/test-helpers/mock-idp";

const PORT = Number(process.env.MOCK_IDP_PORT ?? "3101");

async function main() {
  const idp = await startMockIdp({ sub: "e2e-user", email: "e2e@example.com" }, PORT);
  console.log(`Mock IdP listening on ${idp.issuerUrl}`);

  const shutdown = async () => {
    await idp.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
