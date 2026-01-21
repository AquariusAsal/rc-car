// --- KONFIGURATION ---
let bluetoothDevice;
let characteristic;

// Standard UUIDs für HM-10 Module. 
// Falls es nicht verbindet, prüfen Sie, ob Ihr Modul andere UUIDs hat.
const serviceUUID = 0xFFE0; 
const charUUID = 0xFFE1;    

// Button Elemente referenzieren
const buttons = {
    'F': document.getElementById('btn-up'),
    'B': document.getElementById('btn-down'),
    'L': document.getElementById('btn-left'),
    'R': document.getElementById('btn-right'),
    'S': document.getElementById('btn-stop')
};

// --- BLUETOOTH FUNKTIONEN ---

async function connectBluetooth() {
    try {
        updateStatus("Suche...", false);
        
        // Browser Scan Dialog öffnen
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [serviceUUID] }]
        });

        // Event-Listener: Wenn Verbindung abbricht
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        // Verbindung aufbauen
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);

        updateStatus("Verbunden", true);
        document.getElementById('btn-connect').style.display = 'none'; // Button ausblenden

    } catch (error) {
        console.error("Verbindungsfehler:", error);
        updateStatus("Fehler / Abbruch", false);
    }
}

function onDisconnected() {
    updateStatus("Verbindung verloren", false);
    document.getElementById('btn-connect').style.display = 'block';
}

function updateStatus(text, connected) {
    document.getElementById('status-text').innerText = text;
    const led = document.getElementById('led');
    if (connected) {
        led.classList.add('on');
    } else {
        led.classList.remove('on');
    }
}

// --- SENDEN ---

async function send(cmd) {
    // Kurze Vibration am Handy (Feedback), falls unterstützt
    if (navigator.vibrate) navigator.vibrate(15); 
    
    if (!characteristic) {
        console.log("Nicht verbunden, kann nicht senden: " + cmd);
        return;
    }

    try {
        const encoder = new TextEncoder();
        await characteristic.writeValue(encoder.encode(cmd));
        // console.log("Gesendet:", cmd); // Zum Debuggen einkommentieren
    } catch (err) { 
        console.log("Sende-Fehler", err); 
        onDisconnected(); // Vermutlich Verbindung weg
    }
}

// --- TOUCH & MAUS EVENT HANDLER ---

// Hilfsfunktion: Verbindet Touch/Maus-Ereignisse mit Sende-Logik
function bindButton(key, element) {
    
    // Drücken (Start)
    const start = (e) => {
        if (e.cancelable) e.preventDefault(); // Verhindert Scrollen/Zoomen
        element.classList.add('active');      // CSS Klasse für Optik
        send(key);                            // Befehl senden
    };
    
    // Loslassen (Ende)
    const end = (e) => {
        if (e.cancelable) e.preventDefault();
        element.classList.remove('active');
        send('S');                            // Immer STOP senden beim Loslassen
    };

    // Maus Events (für PC Tests)
    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', end);

    // Touch Events (für Smartphone)
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
}

// Events an die Buttons binden
bindButton('F', buttons['F']); // Vorwärts
bindButton('B', buttons['B']); // Rückwärts
bindButton('L', buttons['L']); // Links
bindButton('R', buttons['R']); // Rechts

// Stop Button (Klick reicht hier)
buttons['S'].addEventListener('click', (e) => {
    e.preventDefault();
    send('S');
});