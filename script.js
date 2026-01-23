/* --- KONFIGURATION --- */
let bluetoothDevice;
let characteristic;
const serviceUUID = 0xFFE0;
const charUUID = 0xFFE1;

/* --- UI ELEMENTE --- */
const els = {
    layoutPS4: document.getElementById('layout-ps4'),
    layoutWheel: document.getElementById('layout-wheel'),
    layoutAuto: document.getElementById('layout-auto'),
    modal: document.getElementById('settings-modal'),
    wheelImg: document.getElementById('steering-wheel'), // Das Bild
    speed: document.getElementById('speed-display'),
    status: document.getElementById('connection-status'),
    gauge: document.querySelector('.gauge'),
    gpStatus: document.getElementById('gamepad-status')
};

let lastCmd = 'S';
let currentMode = 'ps4'; // Standard Modus

/* --- BLUETOOTH --- */
async function connectBluetooth() {
    try {
        els.status.innerText = "SUCHE...";
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true, optionalServices: [serviceUUID]
        });
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleNotifications);

        els.status.innerText = "CAR: ONLINE";
        els.status.classList.add('connected');
        document.getElementById('btn-connect').style.display = 'none';
    } catch (err) { console.error(err); els.status.innerText = "FEHLER"; }
}

function onDisconnected() {
    els.status.innerText = "CAR: OFFLINE";
    els.status.classList.remove('connected');
    document.getElementById('btn-connect').style.display = 'block';
}

function handleNotifications(event) {
    const dec = new TextDecoder();
    const val = parseFloat(dec.decode(event.target.value));
    if(!isNaN(val)) updateTacho(val);
}

function updateTacho(val) {
    els.speed.innerText = val.toFixed(1);
    let pct = (val / 2.0) * 100;
    if(pct>100) pct=100;
    els.gauge.style.background = `conic-gradient(#00e5ff ${pct}%, #333 ${pct}%)`;
}

async function send(cmd) {
    if(cmd === lastCmd) return; // Spam verhindern
    lastCmd = cmd;
    if(navigator.vibrate && cmd !== 'S') navigator.vibrate(10);
    if(!characteristic) return;
    try { await characteristic.writeValue(new TextEncoder().encode(cmd)); } catch(e) {}
}

/* --- EINSTELLUNGEN --- */
function toggleSettings() { els.modal.classList.toggle('hidden'); }

function changeLayout() {
    currentMode = document.getElementById('mode-selector').value;
    els.layoutPS4.classList.add('hidden');
    els.layoutWheel.classList.add('hidden');
    els.layoutAuto.classList.add('hidden');

    if(currentMode === 'ps4') els.layoutPS4.classList.remove('hidden');
    if(currentMode === 'wheel') els.layoutWheel.classList.remove('hidden');
    if(currentMode === 'auto') els.layoutAuto.classList.remove('hidden');
    toggleSettings();
}

/* --- NEU: GAMEPAD API LOOP (Für echten Controller) --- */
let gamepadIndex = null;

window.addEventListener("gamepadconnected", (e) => {
    gamepadIndex = e.gamepad.index;
    els.gpStatus.innerText = "Controller verbunden! (" + e.gamepad.id + ")";
    els.gpStatus.classList.add('active');
    els.gpStatus.classList.remove('pulsing');
    gameLoop(); // Startet die Schleife
});

window.addEventListener("gamepaddisconnected", () => {
    gamepadIndex = null;
    els.gpStatus.innerText = "Controller getrennt. Warte...";
    els.gpStatus.classList.remove('active');
    els.gpStatus.classList.add('pulsing');
});

function gameLoop() {
    if (gamepadIndex === null || currentMode !== 'ps4') {
        requestAnimationFrame(gameLoop); // Weiter laufen lassen, falls Modus gewechselt wird
        return;
    }

    const gp = navigator.getGamepads()[gamepadIndex];
    if (!gp) return;

    let newCmd = 'S';
    const deadzone = 0.3; // Ignoriere kleine Bewegungen

    // Linker Stick Y-Achse (Index 1) für Vor/Zurück
    let stickLeftY = gp.axes[1];
    
    // Rechter Stick X-Achse (Index 2) für Links/Rechts
    let stickRightX = gp.axes[2];

    // Priorität: Lenken überschreibt Fahren (einfache Logik)
    if (stickRightX < -deadzone) {
        newCmd = 'L';
    } else if (stickRightX > deadzone) {
        newCmd = 'R';
    } else {
        // Wenn nicht gelenkt wird, prüfe Fahren
        if (stickLeftY < -deadzone) { // Negativ ist meist "oben" beim Controller
            newCmd = 'F';
        } else if (stickLeftY > deadzone) {
            newCmd = 'B';
        }
    }

    send(newCmd); // Sendet nur, wenn sich der Befehl ändert (siehe send Funktion)
    requestAnimationFrame(gameLoop); // Nächster Frame
}

/* --- LOGIK: TOUCH LENKRAD (Racing Mode) --- */
let wheelActive = false;
els.wheelImg.addEventListener('touchstart', (e) => { e.preventDefault(); wheelActive = true; }, {passive:false});
els.wheelImg.addEventListener('touchmove', (e) => {
    if(!wheelActive) return; e.preventDefault();
    const rect = els.wheelImg.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Winkel berechnen
    const angleRad = Math.atan2(e.touches[0].clientY - centerY, e.touches[0].clientX - centerX);
    let angleDeg = angleRad * (180 / Math.PI) + 90;
    // Begrenzen auf +/- 90 Grad
    if(angleDeg > 90) angleDeg = 90; if(angleDeg < -90) angleDeg = -90;
    // Bild drehen
    els.wheelImg.style.transform = `rotate(${angleDeg}deg)`;
    // Befehle
    if(angleDeg < -20) send('L'); else if(angleDeg > 20) send('R'); else send('S');
}, {passive:false});
els.wheelImg.addEventListener('touchend', () => {
    wheelActive = false; els.wheelImg.style.transform = `rotate(0deg)`; send('S');
});

// Pedale (Touch)
const bindPedal = (id, cmd) => {
    const elem = document.getElementById(id);
    elem.addEventListener('touchstart', (e)=>{e.preventDefault(); elem.classList.add('active'); send(cmd);});
    elem.addEventListener('touchend', (e)=>{e.preventDefault(); elem.classList.remove('active'); send('S');});
};
bindPedal('pedal-gas', 'F'); bindPedal('pedal-brake', 'B');