// --- KONFIGURATION ---
let bluetoothDevice;
let characteristic;

// UUIDs für HM-10 (Standard). 
// Falls das Auto nicht reagiert, müssen diese evtl. geändert werden.
const serviceUUID = 0xFFE0; 
const charUUID = 0xFFE1;    

const buttons = {
    'F': document.getElementById('btn-up'),
    'B': document.getElementById('btn-down'),
    'L': document.getElementById('btn-left'),
    'R': document.getElementById('btn-right'),
    'S': document.getElementById('btn-stop')
};

// --- BLUETOOTH ---

async function connectBluetooth() {
    try {
        updateStatus("Suche...", false);
        
        // FIX: Wir akzeptieren JETZT ALLE Geräte.
        // Das erzwingt das Pop-up Fenster auf Android.
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [serviceUUID] // Wichtig: Damit wir später Zugriff haben
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bluetoothDevice.gatt.connect();
        
        // Wir versuchen den Service zu holen
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);

        updateStatus("Verbunden!", true);
        document.getElementById('btn-connect').style.display = 'none';

    } catch (error) {
        console.error("Fehler:", error);
        // Falls der Service nicht gefunden wird (falsches Modul?)
        if(error.toString().includes("Service not found")) {
             alert("Verbunden, aber Service nicht gefunden! Ist es ein HM-10?");
        } else {
             updateStatus("Fehler: " + error, false);
        }
    }
}

function onDisconnected() {
    updateStatus("Verbindung verloren", false);
    document.getElementById('btn-connect').style.display = 'block';
}

function updateStatus(text, connected) {
    document.getElementById('status-text').innerText = text;
    const led = document.getElementById('led');
    if (connected) led.classList.add('on');
    else led.classList.remove('on');
}

// --- SENDEN ---
async function send(cmd) {
    if (navigator.vibrate) navigator.vibrate(15);
    
    if (!characteristic) return;

    try {
        const encoder = new TextEncoder();
        await characteristic.writeValue(encoder.encode(cmd));
    } catch (err) { 
        console.log("Sende-Fehler", err); 
        // Falls Fehler beim Senden -> Verbindung wohl weg
        onDisconnected();
    }
}

// --- TOUCH & MAUS HANDLING ---
function bindButton(key, element) {
    const start = (e) => {
        if (e.cancelable) e.preventDefault();
        element.classList.add('active');
        send(key);
    };
    const end = (e) => {
        if (e.cancelable) e.preventDefault();
        element.classList.remove('active');
        send('S');
    };

    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', end);
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
}

bindButton('F', buttons['F']);
bindButton('B', buttons['B']);
bindButton('L', buttons['L']);
bindButton('R', buttons['R']);

buttons['S'].addEventListener('click', (e) => {
    e.preventDefault();
    send('S');
});
