/* * RC FPV Controller - Differential Drive Edition
 * Logik für Panzersteuerung / Differentialantrieb
 */

// --- GLOBALS ---
let bluetoothDevice;
let characteristic;
const serviceUUID = 0xFFE0;
const charUUID = 0xFFE1;

let lastCmd = 'S';
let currentMode = 'ps4';
let wheelActive = false;
let gamepadIndex = null;

// ZENTRALE STATUSWERTE (-1.0 bis 1.0)
let inputState = {
    throttle: 0, // 1 = Vor, -1 = Zurück
    steering: 0  // -1 = Links, 1 = Rechts
};

// UI Elemente cachen
const els = {
    status: document.getElementById('connection-status'),
    speed: document.getElementById('speed-display'),
    gauge: document.querySelector('.gauge'),
    layouts: {
        ps4: document.getElementById('layout-ps4'),
        wheel: document.getElementById('layout-wheel'),
        auto: document.getElementById('layout-auto')
    },
    modal: document.getElementById('settings-modal'),
    wheel: document.getElementById('steering-wheel'),
    pedalGas: document.getElementById('pedal-gas'),
    pedalBrake: document.getElementById('pedal-brake'),
    gpStatus: document.getElementById('gamepad-status'),
    camStream: document.getElementById('camera-stream'),
    camIpInput: document.getElementById('camera-ip')
};

// --- CORE LOGIC: BEFEHLS-BERECHNUNG ---
// Hier passiert die Magie für das Differential
function evaluateCommand() {
    const t = inputState.throttle;
    const s = inputState.steering;
    let cmd = 'S';

    // Totzone für kleine Wackler
    const deadzone = 0.15;

    if (t > deadzone) { 
        // --- VORWÄRTS FAHREN ---
        if (s < -deadzone) cmd = 'G';      // Vorwärts-Links (Kurve)
        else if (s > deadzone) cmd = 'I';  // Vorwärts-Rechts (Kurve)
        else cmd = 'F';                    // Geradeaus
    } 
    else if (t < -deadzone) {
        // --- RÜCKWÄRTS FAHREN ---
        if (s < -deadzone) cmd = 'H';      // Rückwärts-Links (Kurve)
        else if (s > deadzone) cmd = 'J';  // Rückwärts-Rechts (Kurve)
        else cmd = 'B';                    // Zurück
    } 
    else {
        // --- IM STAND DREHEN (Panzer-Modus) ---
        if (s < -deadzone) cmd = 'L';      // Drehen Links (Hart)
        else if (s > deadzone) cmd = 'R';  // Drehen Rechts (Hart)
        else cmd = 'S';                    // Stop
    }

    send(cmd);
    updateVisuals(cmd);
}

// Visuelles Feedback für Lenkrad und Pedale
function updateVisuals(cmd) {
    // Pedale leuchten lassen
    if(cmd === 'F' || cmd === 'G' || cmd === 'I') els.pedalGas.classList.add('active');
    else els.pedalGas.classList.remove('active');

    if(cmd === 'B' || cmd === 'H' || cmd === 'J') els.pedalBrake.classList.add('active');
    else els.pedalBrake.classList.remove('active');

    // Lenkrad drehen (wenn Tastatur genutzt wird)
    if(!wheelActive) {
        let rot = 0;
        if (inputState.steering < -0.1) rot = -90;
        if (inputState.steering > 0.1) rot = 90;
        els.wheel.style.transform = `rotate(${rot}deg)`;
    }
}

// --- BLUETOOTH ---
async function connectBluetooth() {
    try {
        els.status.innerText = "SUCHE...";
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [serviceUUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);
        
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleData);

        els.status.innerText = "SYSTEM: ONLINE";
        els.status.classList.add('connected');
        document.getElementById('btn-connect').style.display = 'none';
    } catch (err) {
        console.error(err);
        alert("Fehler bei Bluetooth Verbindung!");
        els.status.innerText = "OFFLINE";
    }
}

function onDisconnected() {
    els.status.innerText = "OFFLINE";
    els.status.classList.remove('connected');
    document.getElementById('btn-connect').style.display = 'block';
}

function handleData(event) {
    const dec = new TextDecoder();
    const val = parseFloat(dec.decode(event.target.value));
    if (!isNaN(val)) {
        els.speed.innerText = val.toFixed(1);
        let pct = (val / 2.0) * 100;
        els.gauge.style.background = `conic-gradient(#00e5ff ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
    }
}

async function send(cmd) {
    if (cmd === lastCmd) return;
    lastCmd = cmd;
    if (navigator.vibrate && cmd !== 'S') navigator.vibrate(10);
    if (!characteristic) return;
    try {
        const enc = new TextEncoder();
        await characteristic.writeValue(enc.encode(cmd));
    } catch (e) { console.warn(e); }
}

// --- TASTATUR STEUERUNG (WASD & Pfeile) ---
const keys = { w:0, a:0, s:0, d:0 };

document.addEventListener('keydown', (e) => updateKeys(e.code, 1));
document.addEventListener('keyup', (e) => updateKeys(e.code, 0));

function updateKeys(code, val) {
    if (code === 'ArrowUp' || code === 'KeyW') keys.w = val;
    if (code === 'ArrowDown' || code === 'KeyS') keys.s = val;
    if (code === 'ArrowLeft' || code === 'KeyA') keys.a = val;
    if (code === 'ArrowRight' || code === 'KeyD') keys.d = val;

    // Werte berechnen
    inputState.throttle = keys.w - keys.s; // 1, 0, oder -1
    inputState.steering = keys.d - keys.a; // 1, 0, oder -1
    
    // Nur auswerten wenn Lenkrad nicht berührt wird
    if (!wheelActive) evaluateCommand();
}

// --- TOUCH LENKRAD ---
els.wheel.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    wheelActive = true; 
    els.wheel.style.transition = 'none';
}, {passive:false});

document.addEventListener('touchmove', (e) => {
    if (!wheelActive) return;
    e.preventDefault();
    const rect = els.wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const touch = e.touches[0];
    
    const radians = Math.atan2(touch.clientY - centerY, touch.clientX - centerX);
    let degrees = radians * (180 / Math.PI) + 90;
    if (degrees > 90) degrees = 90;
    if (degrees < -90) degrees = -90;

    els.wheel.style.transform = `rotate(${degrees}deg)`;
    
    // Steering Wert setzen (-1 bis 1)
    inputState.steering = degrees / 90;
    evaluateCommand();
}, {passive:false});

document.addEventListener('touchend', () => {
    if(wheelActive) {
        wheelActive = false;
        els.wheel.style.transition = 'transform 0.2s cubic-bezier(0.1, 0.7, 1.0, 0.1)';
        els.wheel.style.transform = `rotate(0deg)`;
        inputState.steering = 0;
        evaluateCommand();
    }
});

// --- TOUCH PEDALE ---
const bindPedal = (id, val) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        inputState.throttle = val; 
        evaluateCommand(); 
    });
    el.addEventListener('touchend', (e) => { 
        e.preventDefault(); 
        inputState.throttle = 0; 
        evaluateCommand(); 
    });
};
bindPedal('pedal-gas', 1);
bindPedal('pedal-brake', -1);

// --- GAMEPAD LOOP ---
window.addEventListener("gamepadconnected", (e) => {
    gamepadIndex = e.gamepad.index;
    els.gpStatus.innerText = "Controller bereit!";
    els.gpStatus.classList.add('active');
    els.gpStatus.classList.remove('pulsing');
    requestAnimationFrame(gameLoop);
});

function gameLoop() {
    if (gamepadIndex !== null && currentMode === 'ps4') {
        const gp = navigator.getGamepads()[gamepadIndex];
        if(gp) {
            // Analog Sticks lesen
            inputState.throttle = -gp.axes[1]; // Y-Achse invertiert
            inputState.steering = gp.axes[2];  // X-Achse
            
            // Kleine Deadzone filtern
            if(Math.abs(inputState.throttle) < 0.1) inputState.throttle = 0;
            if(Math.abs(inputState.steering) < 0.1) inputState.steering = 0;
            
            evaluateCommand();
        }
        requestAnimationFrame(gameLoop);
    }
}

// --- SETUP ---
function startStream() {
    const ip = els.camIpInput.value.trim();
    if (ip.length > 6) {
        els.camStream.src = `http://${ip}:81/stream`;
        localStorage.setItem('saved_cam_ip', ip);
        toggleSettings();
    }
}
function toggleSettings() { els.modal.classList.toggle('hidden'); }
function changeLayout() {
    currentMode = document.getElementById('mode-selector').value;
    Object.values(els.layouts).forEach(el => el.classList.add('hidden'));
    if (els.layouts[currentMode]) els.layouts[currentMode].classList.remove('hidden');
    if (currentMode === 'ps4' && gamepadIndex !== null) requestAnimationFrame(gameLoop);
}
window.onload = () => {
    const savedIP = localStorage.getItem('saved_cam_ip');
    if (savedIP) els.camIpInput.value = savedIP;
};