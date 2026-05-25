import fetch from 'node-fetch';

const BRIDGE_URL = process.env.BRIDGE_URL;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;

export const handler = async (event) => {
  const body = JSON.parse(event.body || '{}');
  const { requestId, inputs } = body;

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

  return { statusCode: 400, body: JSON.stringify({ error: 'Unhandled intent' }) };
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
