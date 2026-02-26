import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001/teach');

ws.on('open', () => {
    console.log('Connected');
    ws.send(JSON.stringify({
        type: 'start',
        lessonPlan: {
            title: 'Test',
            sections: [
                {
                    title: 'Sec 1',
                    script: 'Hello world. [C1] This is a test. [C2]',
                    cues: {
                        C1: { cmd: 'title', text: 'Hello' },
                        C2: { cmd: 'write', text: 'Test' }
                    }
                }
            ]
        }
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('<-', msg.type, msg.type === 'draw' ? msg.commands : '');
});

ws.on('close', () => console.log('Closed'));
ws.on('error', console.error);
