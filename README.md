# wake-on-home

Wake your PC from the Google Home app — no physical device required. A button press in the Google Home app sends a Wake-on-LAN magic packet to your sleeping machine over your local network.

---

## Architecture

```
Google Home App (virtual switch button)
  └─► Google Smart Home Action (OAuth2 fulfillment)
        └─► AWS Lambda (intent handler)
              └─► Local WoL Bridge (via Cloudflare Tunnel)
                    └─► UDP magic packet → PC wakes up
```

**Why a local bridge?** Lambda runs in AWS and can't reach a UDP broadcast address on your home LAN. The bridge is a tiny always-on Node.js process (router, Pi, NAS, or any box that stays awake) that listens for an HTTP request and fires the magic packet locally.

---

## Prerequisites

- AWS account with CLI configured (`aws configure`)
- Node.js 20+ and npm
- Google account
- [Actions on Google Console](https://console.actions.google.com) access
- [Cloudflare account](https://cloudflare.com) (free tier is fine) for the tunnel
- `cloudflared` installed on the always-on local device
- Your PC's MAC address (run `ipconfig /all` on Windows → look for "Physical Address" on your Ethernet or Wi-Fi adapter)
- WoL enabled in BIOS and Windows (see PC Setup below)

---

## Repo Structure

```
wake-on-home/
├── bridge/               # Local WoL bridge (runs on always-on LAN device)
│   ├── index.js
│   └── package.json
├── lambda/               # AWS Lambda fulfillment handler
│   ├── index.js
│   └── package.json
├── actions/              # Google Smart Home Action config
│   └── action.json
├── .env.example
└── README.md
```

---

## Step 1 — PC Setup

### BIOS
1. Reboot and enter BIOS (usually `Del` or `F2` on POST)
2. Navigate to **Power Management** (may be under Advanced)
3. Enable **Wake on LAN** / **Power On by PCI-E** / **Resume by LAN** — exact label varies by board
4. Save and exit

### Windows
1. Open **Device Manager** → **Network Adapters**
2. Right-click your Ethernet/Wi-Fi adapter → **Properties**
3. **Power Management** tab → check **Allow this device to wake the computer**
4. **Advanced** tab → set **Wake on Magic Packet** to **Enabled**
5. Open **Control Panel → Power Options → Choose what the power buttons do → Change settings that are currently unavailable**
6. Uncheck **Turn on fast startup** (fast startup can block WoL)

---

## Step 2 — Local WoL Bridge

This runs on any always-on device on your LAN (router running OpenWrt, Raspberry Pi, NAS, etc.).

### `bridge/package.json`
```json
{
  "name": "wol-bridge",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.18.0",
    "wol": "^1.0.7"
  }
}
```

### `bridge/index.js`
```js
import express from 'express';
import wol from 'wol';

const app = express();
app.use(express.json());

const MAC = process.env.PC_MAC_ADDRESS; // e.g. "AA:BB:CC:DD:EE:FF"
const BRIDGE_SECRET = process.env.BRIDGE_SECRET; // shared secret with Lambda

app.post('/wake', (req, res) => {
  if (req.headers['x-bridge-secret'] !== BRIDGE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  wol.wake(MAC, (err) => {
    if (err) {
      console.error('WoL error:', err);
      return res.status(500).json({ error: 'Failed to send magic packet' });
    }
    console.log(`Magic packet sent to ${MAC}`);
    res.json({ success: true });
  });
});

app.listen(3000, () => console.log('WoL bridge listening on :3000'));
```

### Setup & Run
```bash
cd bridge
npm install
PC_MAC_ADDRESS="AA:BB:CC:DD:EE:FF" BRIDGE_SECRET="your-secret-here" node index.js
```

To keep it running:
```bash
npm install -g pm2
pm2 start index.js --name wol-bridge
pm2 save
pm2 startup
```

### Cloudflare Tunnel (exposes bridge to Lambda)
```bash
# Install cloudflared on the bridge device
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

cloudflared tunnel login
cloudflared tunnel create wake-on-home
cloudflared tunnel route dns wake-on-home wake.yourdomain.com

# Create config
cat > ~/.cloudflared/config.yml << EOF
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json
ingress:
  - hostname: wake.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

cloudflared tunnel run wake-on-home
```

Your bridge is now reachable at `https://wake.yourdomain.com/wake` from anywhere.

---

## Step 3 — AWS Lambda

### `lambda/package.json`
```json
{
  "name": "wake-on-home-lambda",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "node-fetch": "^3.3.0"
  }
}
```

### `lambda/index.js`
```js
import fetch from 'node-fetch';

const BRIDGE_URL = process.env.BRIDGE_URL;       // https://wake.yourdomain.com/wake
const BRIDGE_SECRET = process.env.BRIDGE_SECRET; // same secret as bridge

export const handler = async (event) => {
  const body = JSON.parse(event.body || '{}');
  const { requestId, inputs } = body;

  // Handle Google Smart Home intents
  for (const input of inputs) {
    if (input.intent === 'action.devices.SYNC') {
      return buildSyncResponse(requestId);
    }

    if (input.intent === 'action.devices.QUERY') {
      return buildQueryResponse(requestId);
    }

    if (input.intent === 'action.devices.EXECUTE') {
      const command = input.payload.commands[0];
      const execution = command.execution[0];

      if (execution.command === 'action.devices.commands.OnOff' && execution.params.on) {
        await fetch(BRIDGE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-secret': BRIDGE_SECRET,
          },
          body: JSON.stringify({ wake: true }),
        });
      }

      return buildExecuteResponse(requestId, command.devices.map(d => d.id));
    }
  }
};

function buildSyncResponse(requestId) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      requestId,
      payload: {
        agentUserId: 'local-user',
        devices: [{
          id: 'pc-wake-switch',
          type: 'action.devices.types.SWITCH',
          traits: ['action.devices.traits.OnOff'],
          name: { name: 'PC' },
          willReportState: false,
        }],
      },
    }),
  };
}

function buildQueryResponse(requestId) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      requestId,
      payload: {
        devices: { 'pc-wake-switch': { on: false, online: true } },
      },
    }),
  };
}

function buildExecuteResponse(requestId, deviceIds) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      requestId,
      payload: {
        commands: [{
          ids: deviceIds,
          status: 'SUCCESS',
          states: { on: true, online: true },
        }],
      },
    }),
  };
}
```

### Deploy Lambda
```bash
cd lambda
npm install
zip -r function.zip .

aws lambda create-function \
  --function-name wake-on-home \
  --runtime nodejs20.x \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<YOUR_ACCOUNT_ID>:role/lambda-basic-execution

aws lambda update-function-configuration \
  --function-name wake-on-home \
  --environment "Variables={BRIDGE_URL=https://wake.yourdomain.com/wake,BRIDGE_SECRET=your-secret-here}"
```

### Create API Gateway Endpoint
```bash
# Create HTTP API
aws apigatewayv2 create-api \
  --name wake-on-home \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-1:<ACCOUNT_ID>:function:wake-on-home

# Note the API endpoint URL from the output — you'll need it for the Actions project
```

Grant API Gateway permission to invoke Lambda:
```bash
aws lambda add-permission \
  --function-name wake-on-home \
  --statement-id apigw-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com
```

---

## Step 4 — Google Smart Home Action

### Create the Project
1. Go to [console.actions.google.com](https://console.actions.google.com)
2. **New Project** → name it `wake-on-home` → **Smart Home** template
3. Under **Build → Actions**, set the fulfillment URL to your API Gateway endpoint URL
4. Under **Account Linking**, set up OAuth2:
   - Grant type: **Authorization Code**
   - For a personal project you can use a simple OAuth2 server, or use [oauth2-mock-server](https://github.com/axa-group/oauth2-mock-server) deployed to Lambda/Cloud Run
   - Client ID and Secret: make up any values and match them in your Lambda env vars
5. Note your **Project ID** — you'll need it

### Link to Google Home
1. Open the **Google Home** app on your phone
2. Tap **+** → **Set up device** → **Works with Google**
3. Search for your action (use the `[test]` prefix during development)
4. Sign in (OAuth2 flow)
5. Your **PC** switch will appear as a device in the app

---

## Step 5 — Create the Button in Google Home

1. In Google Home, go to **Automations** → **+**
2. Set **Starter** to: **A device does something** → select **PC** → **Turned on**
   - Or simply use the device tile directly as your button — tapping it in the app sends the `OnOff` command
3. The device tile on your Google Home home screen is your one-tap wake button

You can also trigger it with **"Hey Google, turn on PC"** if you want voice as a backup.

---

## Environment Variables Reference

| Variable | Where | Value |
|---|---|---|
| `PC_MAC_ADDRESS` | Bridge | Your PC's MAC, e.g. `AA:BB:CC:DD:EE:FF` |
| `BRIDGE_SECRET` | Bridge + Lambda | Any shared secret string |
| `BRIDGE_URL` | Lambda | `https://wake.yourdomain.com/wake` |

---

## Testing

```bash
# Test bridge directly
curl -X POST https://wake.yourdomain.com/wake \
  -H "x-bridge-secret: your-secret-here" \
  -H "Content-Type: application/json" \
  -d '{}'

# Test Lambda manually
aws lambda invoke \
  --function-name wake-on-home \
  --payload '{"body":"{\"requestId\":\"test\",\"inputs\":[{\"intent\":\"action.devices.EXECUTE\",\"payload\":{\"commands\":[{\"devices\":[{\"id\":\"pc-wake-switch\"}],\"execution\":[{\"command\":\"action.devices.commands.OnOff\",\"params\":{\"on\":true}}]}]}}]}"}' \
  output.json && cat output.json
```

---

## Notes

- The switch will always appear "off" in the Google Home app — that's intentional. It's a momentary trigger, not a stateful toggle. Tapping it sends the wake signal; the PC doesn't report its power state back.
- WoL only works reliably over **Ethernet**. Wi-Fi WoL is unreliable on most hardware.
- If your PC is on a different subnet than the bridge device, you may need to configure a directed broadcast address in the `wol.wake()` call (pass `address` option).
- The Cloudflare Tunnel keeps the bridge secure without port forwarding on your router.
