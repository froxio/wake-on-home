import express from 'express';
import wol from 'wol';

const app = express();
app.use(express.json());

const MAC = process.env.PC_MAC_ADDRESS;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;

if (!MAC) throw new Error('PC_MAC_ADDRESS env var is required');
if (!BRIDGE_SECRET) throw new Error('BRIDGE_SECRET env var is required');

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
