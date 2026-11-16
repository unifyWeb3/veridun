const EXPECTED_VK_HASH =
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

const response = await fetch('https://agentgames.zkverify.io/api/circuit-info', {
  headers: {
    accept: 'application/json',
    'user-agent': 'Veridun/0.1 (+zkVerify Agent Games)',
  },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  console.error(`Circuit info request returned HTTP ${response.status}`);
  process.exitCode = 1;
} else {
  const info = await response.json();
  const gatekeeper = info?.circuits?.gatekeeper;
  if (gatekeeper?.vkHash?.toLowerCase() !== EXPECTED_VK_HASH) {
    console.error(
      `Registered VK hash mismatch: expected ${EXPECTED_VK_HASH}, received ${gatekeeper?.vkHash ?? 'missing'}`,
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(info, null, 2));
    console.log('Official circuit identity verified');
  }
}
