let bluetoothDevice;
let characteristic;
const serviceUUID = "0000ffe0-0000-1000-8000-00805f9b34fb"; // HM-10 BLE Service
const charUUID    = "0000ffe1-0000-1000-8000-00805f9b34fb"; // HM-10 BLE Charakteristik

let lastCmd = 'S';
let currentMode = 'ps4';
let wheelActive = false;

// Motor-Einstellungen (werden per Schieberegler angepasst)
let motorMaxSpeed = 200; // 0-255
let curveSpeed    = 100; // 0-255 (Innenspur bei Kurven)
let trimA = 0;           // -50 bis +50 Prozent (nur visuell)
let trimB = 0;

let inputState = { throttle: 0, steering: 0 };

const els = {
    status:     document.getElementById('connection-status'),
    speed:      document.getElementById('speed-display'),
    gauge:      document.querySelector('.gauge'),
    layouts: {
        ps4:   document.getElementById('layout-ps4'),
        wheel: document.getElementById('layout-wheel'),
        auto:  document.getElementById('layout-auto')
    },
    modal:      document.getElementById('settings-modal'),
    motorPanel: document.getElementById('motor-panel'),
    wheel:      document.getElementById('steering-wheel'),
    pedalGas:   document.getElementById('pedal-gas'),
    pedalBrake: document.getElementById('pedal-brake'),
    gpStatus:   document.getElementById('gamepad-status'),
    camStream:  document.getElementById('camera-stream'),
    camIpInput: document.getElementById('camera-ip'),
    barA:       document.getElementById('bar-a'),
    barB:       document.getElementById('bar-b'),
    pctA:       document.getElementById('pct-a'),
    pctB:       document.getElementById('pct-b'),
};

// Berechnet die aktuellen Motorgeschwindigkeiten basierend auf dem Fahrbefehl
function getMotorSpeeds(cmd) {
    const max = motorMaxSpeed;
    const cur = curveSpeed;
    let rawA = 0, rawB = 0;

    switch (cmd) {
        case 'F': rawA =  max; rawB =  max; break; // Geradeaus vorwärts
        case 'B': rawA = -max; rawB = -max; break; // Geradeaus rückwärts
        case 'L': rawA = -max; rawB =  max; break; // Panzer-Drehung links
        case 'R': rawA =  max; rawB = -max; break; // Panzer-Drehung rechts
        case 'G': rawA =  cur; rawB =  max; break; // Kurve vorwärts-links
        case 'I': rawA =  max; rawB =  cur; break; // Kurve vorwärts-rechts
        case 'H': rawA = -cur; rawB = -max; break; // Kurve rückwärts-links
        case 'J': rawA = -max; rawB = -cur; break; // Kurve rückwärts-rechts
        default:  rawA = 0;    rawB = 0;
    }

    // Trimm anwenden (rein visuell – beeinflusst nicht das Arduino-Signal)
    const speedA = Math.max(-255, Math.min(255, rawA * (1 + trimA / 100)));
    const speedB = Math.max(-255, Math.min(255, rawB * (1 + trimB / 100)));
    return { speedA, speedB };
}

function updateMotorDisplay(cmd) {
    const { speedA, speedB } = getMotorSpeeds(cmd);
    const pA = Math.round(Math.abs(speedA) / 255 * 100);
    const pB = Math.round(Math.abs(speedB) / 255 * 100);

    els.barA.style.height = pA + '%';
    els.barB.style.height = pB + '%';

    const fwd = '#ff9f0a'; // orange (vorwärts)
    const bwd = '#0a84ff'; // blau  (rückwärts)
    const off = '#2a2a2a'; // grau  (stop)
    els.barA.style.background = `linear-gradient(to top, ${speedA > 0 ? fwd : speedA < 0 ? bwd : off}, transparent)`;
    els.barB.style.background = `linear-gradient(to top, ${speedB > 0 ? fwd : speedB < 0 ? bwd : off}, transparent)`;

    els.pctA.innerText = pA + '%';
    els.pctB.innerText = pB + '%';

    const avg = (pA + pB) / 2;
    els.speed.innerText = Math.round(avg);
    els.gauge.style.background = `conic-gradient(#00e5ff ${avg}%, rgba(255,255,255,0.07) ${avg}%)`;
}

// --- FAHRBEFEHL-LOGIK ---
function evaluateCommand() {
    const t = inputState.throttle;
    const s = inputState.steering;
    const dz = 0.15;
    let cmd = 'S';

    if      (t >  dz && s < -dz) cmd = 'G';
    else if (t >  dz && s >  dz) cmd = 'I';
    else if (t >  dz)            cmd = 'F';
    else if (t < -dz && s < -dz) cmd = 'H';
    else if (t < -dz && s >  dz) cmd = 'J';
    else if (t < -dz)            cmd = 'B';
    else if (s < -dz)            cmd = 'L';
    else if (s >  dz)            cmd = 'R';

    send(cmd);

    if (cmd === 'F' || cmd === 'G' || cmd === 'I') els.pedalGas.classList.add('active');
    else els.pedalGas.classList.remove('active');

    if (cmd === 'B' || cmd === 'H' || cmd === 'J') els.pedalBrake.classList.add('active');
    else els.pedalBrake.classList.remove('active');

    if (!wheelActive) {
        const rot = s < -0.1 ? -90 : s > 0.1 ? 90 : 0;
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

        const server  = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);

        els.status.innerText = "SYSTEM: ONLINE";
        els.status.classList.add('connected');
        document.getElementById('btn-connect').style.display = 'none';

        // Aktuelle Motor-Einstellungen nach Verbindung senden
        setTimeout(() => {
            sendRaw(`V${motorMaxSpeed}\n`);
            sendRaw(`C${curveSpeed}\n`);
        }, 500);

    } catch (err) {
        console.error(err);
        alert("Bluetooth Verbindungsfehler!");
        els.status.innerText = "SYSTEM: OFFLINE";
    }
}

function onDisconnected() {
    els.status.innerText = "SYSTEM: OFFLINE";
    els.status.classList.remove('connected');
    document.getElementById('btn-connect').style.display = 'block';
    characteristic = null;
}

async function sendRaw(str) {
    if (!characteristic) return;
    try {
        const data = new TextEncoder().encode(str);
        // HM-10 erwartet writeValueWithoutResponse
        if (characteristic.properties.writeWithoutResponse) {
            await characteristic.writeValueWithoutResponse(data);
        } else {
            await characteristic.writeValue(data);
        }
    } catch (e) { console.warn(e); }
}

async function send(cmd) {
    if (cmd === lastCmd) return;
    lastCmd = cmd;
    if (navigator.vibrate && cmd !== 'S') navigator.vibrate(10);
    updateMotorDisplay(cmd);
    await sendRaw(cmd + '\n');
}

// --- MOTOR STEUERUNG ---

// Maximale Geschwindigkeit (0-255) → sendet "V{wert}" an Arduino
function updateMaxSpeed(val) {
    motorMaxSpeed = parseInt(val);
    const pct = Math.round(motorMaxSpeed / 255 * 100);
    document.getElementById('speed-pct-label').innerText = pct + '%';
    setSliderFill('slider-speed', motorMaxSpeed, 255);
    localStorage.setItem('motorMaxSpeed', motorMaxSpeed);
    sendRaw(`V${motorMaxSpeed}\n`);
    updateMotorDisplay(lastCmd);
}

// Kurvendifferenzial (0-255) → sendet "C{wert}" an Arduino
function updateCurveSpeed(val) {
    curveSpeed = parseInt(val);
    const pct = Math.round(curveSpeed / 255 * 100);
    document.getElementById('curve-pct-label').innerText = pct + '%';
    setSliderFill('slider-curve', curveSpeed, 255);
    localStorage.setItem('curveSpeed', curveSpeed);
    sendRaw(`C${curveSpeed}\n`);
    updateMotorDisplay(lastCmd);
}

// Motor-Trimm (nur visuell, kalibriert die Anzeige)
function adjustTrim(motor, delta) {
    if (motor === 'a') {
        trimA = Math.max(-50, Math.min(50, trimA + delta));
        document.getElementById('trim-a-val').innerText = (trimA >= 0 ? '+' : '') + trimA + '%';
        localStorage.setItem('trimA', trimA);
    } else {
        trimB = Math.max(-50, Math.min(50, trimB + delta));
        document.getElementById('trim-b-val').innerText = (trimB >= 0 ? '+' : '') + trimB + '%';
        localStorage.setItem('trimB', trimB);
    }
    updateMotorDisplay(lastCmd);
}

function setSliderFill(id, val, max) {
    const pct = (val / max) * 100;
    document.getElementById(id).style.background =
        `linear-gradient(to right, #ff9f0a ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}

function toggleMotorPanel() {
    const panel = els.motorPanel;
    const btn   = document.getElementById('btn-motor');
    panel.classList.toggle('hidden');
    btn.classList.toggle('active', !panel.classList.contains('hidden'));
}

// --- TASTATUR ---
const keys = { w: 0, a: 0, s: 0, d: 0 };
document.addEventListener('keydown', e => updateKeys(e.code, 1));
document.addEventListener('keyup',   e => updateKeys(e.code, 0));

function updateKeys(code, val) {
    if (code === 'ArrowUp'    || code === 'KeyW') keys.w = val;
    if (code === 'ArrowDown'  || code === 'KeyS') keys.s = val;
    if (code === 'ArrowLeft'  || code === 'KeyA') keys.a = val;
    if (code === 'ArrowRight' || code === 'KeyD') keys.d = val;
    inputState.throttle = keys.w - keys.s;
    inputState.steering = keys.d - keys.a;
    if (!wheelActive) evaluateCommand();
}

// --- TOUCH LENKRAD ---
els.wheel.addEventListener('touchstart', e => {
    e.preventDefault();
    wheelActive = true;
    els.wheel.style.transition = 'none';
}, { passive: false });

document.addEventListener('touchmove', e => {
    if (!wheelActive) return;
    e.preventDefault();
    const rect = els.wheel.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const t  = e.touches[0];
    let deg = Math.atan2(t.clientY - cy, t.clientX - cx) * (180 / Math.PI) + 90;
    deg = Math.max(-90, Math.min(90, deg));
    els.wheel.style.transform = `rotate(${deg}deg)`;
    inputState.steering = deg / 90;
    evaluateCommand();
}, { passive: false });

document.addEventListener('touchend', () => {
    if (wheelActive) {
        wheelActive = false;
        els.wheel.style.transition = 'transform 0.2s cubic-bezier(0.1, 0.7, 1.0, 0.1)';
        els.wheel.style.transform  = 'rotate(0deg)';
        inputState.steering = 0;
        evaluateCommand();
    }
});

// --- TOUCH PEDALE ---
const bindPedal = (id, val) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); inputState.throttle = val; evaluateCommand(); });
    el.addEventListener('touchend',   e => { e.preventDefault(); inputState.throttle = 0;   evaluateCommand(); });
};
bindPedal('pedal-gas',   1);
bindPedal('pedal-brake', -1);

// --- KAMERA ---
function startStream() {
    const ip = els.camIpInput.value.trim();
    if (ip.length > 6) {
        els.camStream.src = `http://${ip}:81/stream`;
        els.camStream.alt = "LADE VIDEO...";
        els.camStream.onerror = function () {
            this.alt = "FEHLER: KEIN BILD! IP PRÜFEN.";
            this.src = "";
        };
        localStorage.setItem('saved_cam_ip', ip);
        toggleSettings();
    } else {
        alert("Bitte eine gültige IP-Adresse eingeben!");
    }
}

// --- ALLGEMEIN ---
function toggleSettings() { els.modal.classList.toggle('hidden'); }

function changeLayout() {
    currentMode = document.getElementById('mode-selector').value;
    Object.values(els.layouts).forEach(el => el.classList.add('hidden'));
    if (els.layouts[currentMode]) els.layouts[currentMode].classList.remove('hidden');
}

// --- INITIALISIERUNG ---
window.onload = () => {
    const savedIp    = localStorage.getItem('saved_cam_ip');
    const savedSpeed = localStorage.getItem('motorMaxSpeed');
    const savedCurve = localStorage.getItem('curveSpeed');
    const savedTrimA = localStorage.getItem('trimA');
    const savedTrimB = localStorage.getItem('trimB');

    if (savedIp) els.camIpInput.value = savedIp;

    if (savedSpeed) {
        motorMaxSpeed = parseInt(savedSpeed);
        document.getElementById('slider-speed').value = motorMaxSpeed;
        document.getElementById('speed-pct-label').innerText =
            Math.round(motorMaxSpeed / 255 * 100) + '%';
    }
    if (savedCurve) {
        curveSpeed = parseInt(savedCurve);
        document.getElementById('slider-curve').value = curveSpeed;
        document.getElementById('curve-pct-label').innerText =
            Math.round(curveSpeed / 255 * 100) + '%';
    }
    if (savedTrimA) {
        trimA = parseInt(savedTrimA);
        document.getElementById('trim-a-val').innerText = (trimA >= 0 ? '+' : '') + trimA + '%';
    }
    if (savedTrimB) {
        trimB = parseInt(savedTrimB);
        document.getElementById('trim-b-val').innerText = (trimB >= 0 ? '+' : '') + trimB + '%';
    }

    setSliderFill('slider-speed', motorMaxSpeed, 255);
    setSliderFill('slider-curve', curveSpeed, 255);
    updateMotorDisplay('S');
    changeLayout();
};
