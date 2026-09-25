/* ==========================================================================
   MINEXA - Underground Mine Safety Command Center Engine
   ========================================================================== */

import { playBeep, playWarningSiren, playEmergencyHorn, toggleSound } from './audio.js';

// --- State Management ---
const state = {
  riskScore: 72,
  riskStatus: 'HIGH RISK',
  hazardSimulated: false,
  soundOn: true,
  cameraMode: 'thermal', // 'thermal', 'night', 'rgb'
  cameraPan: 0,
  irSpotlight: true,
  gasSnifferDeployed: false,
  robotBattery: 84,
  
  // 8 Specific Sensors State
  sensors: {
    o2:    { val: 19.8, unit: '%',   min: 19.5, max: 23.5, status: 'NORMAL', history: [20.1, 20.0, 19.9, 19.8, 19.8, 19.7, 19.8] },
    ch4:   { val: 0.8,  unit: '%',   min: 0.0,  max: 0.5,  status: 'WARNING', history: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.8] },
    co2:   { val: 850,  unit: 'ppm', min: 400,  max: 1000, status: 'NORMAL', history: [780, 800, 820, 830, 840, 850, 850] },
    co:    { val: 38,   unit: 'ppm', min: 0,    max: 35,   status: 'WARNING', history: [22, 25, 28, 31, 35, 37, 38] },
    temp:  { val: 34.2, unit: '°C',  min: 18.0, max: 28.0, status: 'WARNING', history: [28.5, 29.8, 31.0, 32.5, 33.8, 34.2, 34.2] },
    hum:   { val: 82,   unit: '%',   min: 40,   max: 70,   status: 'NORMAL', history: [75, 76, 78, 80, 81, 82, 82] },
    air:   { val: 0.6,  unit: 'm/s', min: 1.2,  max: 3.5,  status: 'WARNING', history: [1.5, 1.3, 1.1, 0.9, 0.8, 0.6, 0.6] },
    smoke: { val: 120,  unit: 'AQI', min: 0,    max: 50,   status: 'WARNING', history: [35, 45, 65, 85, 105, 118, 120] }
  },

  workers: [
    { id: 'W01', name: 'Worker W01', zone: 'Zone A', uwb: 'X:142, Y:88',  dist: 18, status: 'SAFE' },
    { id: 'W02', name: 'Worker W02', zone: 'Zone B', uwb: 'X:305, Y:210', dist: 6,  status: 'AT RISK' },
    { id: 'W03', name: 'Worker W03', zone: 'Zone C', uwb: 'X:512, Y:340', dist: 35, status: 'SAFE' },
    { id: 'W04', name: 'Worker W04', zone: 'Zone D', uwb: 'X:120, Y:410', dist: 42, status: 'SAFE' },
    { id: 'W05', name: 'Worker W05', zone: 'Zone B', uwb: 'X:318, Y:215', dist: 4,  status: 'CRITICAL' }
  ],

  riskHistory30m: [25, 28, 32, 35, 40, 48, 55, 62, 68, 72]
};

// Chart Instance
let riskChartInstance = null;

// --- Initialize Engine ---
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initSparklines();
  initRiskChart();
  initRobotCameraCanvas();
  bindEvents();
  startTelemetryLoop();
});

// --- 1. Live Ticking Clock ---
function initClock() {
  const clockEl = document.getElementById('liveTime');
  const hudTimeEl = document.getElementById('hudTime');

  function updateClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    
    if (clockEl) clockEl.textContent = timeStr;
    if (hudTimeEl) hudTimeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}

// --- 2. Live Sparklines Rendering ---
function initSparklines() {
  Object.keys(state.sensors).forEach(sensorKey => {
    drawSparkline(sensorKey);
  });
}

function drawSparkline(sensorKey) {
  const canvas = document.getElementById(`spark-${sensorKey}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const data = state.sensors[sensorKey].history;
  const status = state.sensors[sensorKey].status;

  ctx.clearRect(0, 0, width, height);

  if (data.length < 2) return;

  const minVal = Math.min(...data) * 0.9;
  const maxVal = Math.max(...data) * 1.1 || 1;

  ctx.beginPath();
  const step = width / (data.length - 1);

  data.forEach((val, i) => {
    const x = i * step;
    const y = height - ((val - minVal) / (maxVal - minVal)) * (height - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  let strokeColor = '#10b981';
  let fillColor = 'rgba(16, 185, 129, 0.15)';
  if (status === 'WARNING') {
    strokeColor = '#f59e0b';
    fillColor = 'rgba(245, 158, 11, 0.15)';
  } else if (status === 'CRITICAL') {
    strokeColor = '#ff0055';
    fillColor = 'rgba(255, 0, 85, 0.2)';
  }

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fill gradient below line
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}

// --- 3. AI Prediction Risk Score Chart (Chart.js) ---
function initRiskChart() {
  const ctx = document.getElementById('riskTrendChart')?.getContext('2d');
  if (!ctx) return;

  const labels = ['-30m', '-27m', '-24m', '-21m', '-18m', '-15m', '-12m', '-9m', '-6m', 'Now'];

  const gradient = ctx.createLinearGradient(0, 0, 0, 140);
  gradient.addColorStop(0, 'rgba(249, 115, 22, 0.4)');
  gradient.addColorStop(1, 'rgba(249, 115, 22, 0.0)');

  // Check if Chart.js is loaded
  if (typeof window.Chart !== 'undefined') {
    riskChartInstance = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'AI Risk Index %',
          data: state.riskHistory30m,
          borderColor: '#f97316',
          borderWidth: 2.5,
          pointBackgroundColor: '#ff0055',
          pointRadius: 3,
          fill: true,
          backgroundColor: gradient,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctx) => ` Risk Index: ${ctx.raw}%`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { size: 10 } }
          }
        }
      }
    });
  }
}

// --- 4. Robot Camera Dynamic Canvas Renderer ---
function initRobotCameraCanvas() {
  const canvas = document.getElementById('robotCamCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let frame = 0;

  function renderCameraFrame() {
    frame++;
    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, width, height);

    // Tunnel 3D Perspective Lines Simulation
    ctx.strokeStyle = state.cameraMode === 'thermal' ? 'rgba(255, 0, 85, 0.3)' : (state.cameraMode === 'night' ? 'rgba(0, 255, 128, 0.3)' : 'rgba(255, 255, 255, 0.2)');
    ctx.lineWidth = 1.5;

    const vpX = width / 2 + state.cameraPan;
    const vpY = height / 2 - 10;

    // Outer Tunnel Box Lines
    ctx.beginPath();
    ctx.moveTo(20, 20); ctx.lineTo(vpX - 80, vpY - 40);
    ctx.moveTo(width - 20, 20); ctx.lineTo(vpX + 80, vpY - 40);
    ctx.moveTo(20, height - 20); ctx.lineTo(vpX - 80, vpY + 40);
    ctx.moveTo(width - 20, height - 20); ctx.lineTo(vpX + 80, vpY + 40);
    ctx.stroke();

    // Center Tunnel Rect
    ctx.strokeRect(vpX - 80, vpY - 40, 160, 80);

    // Simulated Thermal Gas Leak Plume in Zone B Tunnel
    const plumeX = vpX + 30 + Math.sin(frame * 0.05) * 8;
    const plumeY = vpY + 10 + Math.cos(frame * 0.05) * 5;

    const grad = ctx.createRadialGradient(plumeX, plumeY, 5, plumeX, plumeY, 55);

    if (state.cameraMode === 'thermal') {
      grad.addColorStop(0, 'rgba(255, 0, 85, 0.85)');   // Hot Gas Center
      grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.6)');
      grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
    } else if (state.cameraMode === 'night') {
      grad.addColorStop(0, 'rgba(0, 255, 150, 0.9)');
      grad.addColorStop(0.6, 'rgba(0, 180, 100, 0.4)');
      grad.addColorStop(1, 'rgba(0, 40, 20, 0)');
    } else {
      grad.addColorStop(0, 'rgba(200, 200, 255, 0.5)');
      grad.addColorStop(1, 'rgba(100, 100, 120, 0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(plumeX, plumeY, 55, 0, Math.PI * 2);
    ctx.fill();

    // Target Box on Leak
    ctx.strokeStyle = state.cameraMode === 'thermal' ? '#ff0055' : '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plumeX - 25, plumeY - 25, 50, 50);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('TARGET: CH4 LEAK PIPE #B2', plumeX - 55, plumeY - 32);

    // Thermal Color Palette Legend Bar on Right
    if (state.cameraMode === 'thermal') {
      const barGrad = ctx.createLinearGradient(0, 30, 0, height - 30);
      barGrad.addColorStop(0, '#ff0055');
      barGrad.addColorStop(0.3, '#f59e0b');
      barGrad.addColorStop(0.7, '#10b981');
      barGrad.addColorStop(1, '#3b82f6');

      ctx.fillStyle = barGrad;
      ctx.fillRect(width - 24, 30, 8, height - 60);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px JetBrains Mono';
      ctx.fillText('42°C', width - 42, 38);
      ctx.fillText('18°C', width - 42, height - 30);
    }

    // Dynamic Grain Noise Simulation
    const imgData = ctx.getImageData(0, 0, width, height);
    const pix = imgData.data;
    for (let i = 0; i < pix.length; i += 4 * 17) {
      const noise = (Math.random() - 0.5) * 18;
      pix[i] = Math.min(255, Math.max(0, pix[i] + noise));
      pix[i+1] = Math.min(255, Math.max(0, pix[i+1] + noise));
      pix[i+2] = Math.min(255, Math.max(0, pix[i+2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    requestAnimationFrame(renderCameraFrame);
  }

  renderCameraFrame();
}

// --- 5. Telemetry Live Update Loop ---
function startTelemetryLoop() {
  setInterval(() => {
    // Slight random drift for realistic control-room feel
    if (!state.hazardSimulated) {
      state.sensors.ch4.val = parseFloat((0.8 + (Math.random() * 0.04 - 0.02)).toFixed(2));
      state.sensors.o2.val = parseFloat((19.8 + (Math.random() * 0.04 - 0.02)).toFixed(1));
      state.sensors.temp.val = parseFloat((34.2 + (Math.random() * 0.1 - 0.05)).toFixed(1));
      state.sensors.air.val = parseFloat((0.6 + (Math.random() * 0.04 - 0.02)).toFixed(2));
    } else {
      // Elevated Hazard Values
      state.sensors.ch4.val = parseFloat((1.4 + (Math.random() * 0.06 - 0.03)).toFixed(2));
      state.sensors.o2.val = parseFloat((18.9 + (Math.random() * 0.04 - 0.02)).toFixed(1));
      state.sensors.temp.val = parseFloat((38.5 + (Math.random() * 0.2 - 0.1)).toFixed(1));
      state.sensors.air.val = parseFloat((0.3 + (Math.random() * 0.02 - 0.01)).toFixed(2));
      state.sensors.co.val = 52;
      state.sensors.smoke.val = 210;
    }

    // Push new values to histories and update UI
    Object.keys(state.sensors).forEach(key => {
      const sensor = state.sensors[key];
      sensor.history.push(sensor.val);
      if (sensor.history.length > 10) sensor.history.shift();

      // Update DOM values
      const valEl = document.getElementById(`val-${key}`);
      if (valEl) valEl.textContent = sensor.val;

      // Update Sparkline
      drawSparkline(key);
    });

    // Update Risk Score Gauge
    updateRiskScoreUI();

  }, 1800);
}

function updateRiskScoreUI() {
  const gaugePath = document.getElementById('gaugeProgressPath');
  const scoreValEl = document.getElementById('riskScoreVal');
  const statusBox = document.getElementById('riskStatusBox');
  const statusText = document.getElementById('riskStatusText');
  const riskDesc = document.getElementById('riskDescText');
  const predScoreEl = document.getElementById('predRiskScore');
  const predLevelEl = document.getElementById('predRiskLevel');

  let score = state.hazardSimulated ? 88 : 72;
  state.riskScore = score;

  if (scoreValEl) scoreValEl.textContent = `${score}%`;
  if (predScoreEl) predScoreEl.textContent = `${score}%`;

  // SVG Gauge Arc Calculation
  // Arc Circumference ~ 351.8
  const offset = 351.8 - (score / 100) * 351.8;
  if (gaugePath) {
    gaugePath.style.strokeDashoffset = offset;
  }

  if (score >= 76) {
    state.riskStatus = 'CRITICAL';
    if (statusBox) { statusBox.className = 'status-indicator-box critical'; }
    if (statusText) { statusText.textContent = 'CRITICAL HAZARD'; }
    if (gaugePath) { gaugePath.className.baseVal = 'gauge-fill critical-risk-stroke'; }
    if (predLevelEl) { predLevelEl.textContent = 'CRITICAL'; predLevelEl.className = 'pred-val-badge critical-bg'; }
    if (riskDesc) { riskDesc.innerHTML = '<strong>CRITICAL EXPLOSION HAZARD IN ZONE B:</strong> Methane at 1.4%, low airflow (0.3 m/s). Immediate evacuation recommended!'; }
    
    document.getElementById('lvlHigh')?.classList.remove('active');
    document.getElementById('lvlCritical')?.classList.add('active');
  } else if (score >= 51) {
    state.riskStatus = 'HIGH RISK';
    if (statusBox) { statusBox.className = 'status-indicator-box high-risk'; }
    if (statusText) { statusText.textContent = 'HIGH RISK'; }
    if (gaugePath) { gaugePath.className.baseVal = 'gauge-fill high-risk-stroke'; }
    if (predLevelEl) { predLevelEl.textContent = 'HIGH RISK'; predLevelEl.className = 'pred-val-badge high-risk-bg'; }
    if (riskDesc) { riskDesc.innerHTML = 'Elevated methane concentrations detected in <strong>Zone B</strong> paired with reduced airflow velocity. AI model predicts risk escalation if ventilation is not adjusted.'; }

    document.getElementById('lvlCritical')?.classList.remove('active');
    document.getElementById('lvlHigh')?.classList.add('active');
  }
}

// --- 6. Event Listeners & Interactive Controls ---
function bindEvents() {
  // Sound Toggle
  document.getElementById('soundToggleBtn')?.addEventListener('click', () => {
    const isNowOn = toggleSound();
    const icon = document.getElementById('soundIcon');
    if (icon) {
      icon.setAttribute('data-lucide', isNowOn ? 'volume-2' : 'volume-x');
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Simulate Hazard Button
  document.getElementById('simModeBtn')?.addEventListener('click', () => {
    state.hazardSimulated = !state.hazardSimulated;
    const btn = document.getElementById('simModeBtn');
    
    if (state.hazardSimulated) {
      btn.style.background = 'rgba(255, 0, 85, 0.3)';
      btn.style.borderColor = '#ff0055';
      btn.innerHTML = `<i data-lucide="alert-octagon"></i> Reset Normal`;
      playWarningSiren();
    } else {
      btn.style.background = 'rgba(245, 158, 11, 0.15)';
      btn.style.borderColor = '#f59e0b';
      btn.innerHTML = `<i data-lucide="activity"></i> Simulate Hazard`;
      playBeep(600, 'sine', 0.1);
    }
    if (window.lucide) window.lucide.createIcons();
    updateRiskScoreUI();
  });

  // Emergency Alert Button
  document.getElementById('emergencyBtn')?.addEventListener('click', () => {
    playEmergencyHorn();
    document.getElementById('evacuationModal')?.classList.remove('hidden');
  });

  // Close Evacuation Modal
  document.getElementById('closeModalBtn')?.addEventListener('click', () => {
    document.getElementById('evacuationModal')?.classList.addClass('hidden');
  });

  document.getElementById('cancelEvacBtn')?.addEventListener('click', () => {
    document.getElementById('evacuationModal')?.classList.add('hidden');
    playBeep(400, 'sine', 0.1);
  });

  document.getElementById('confirmEvacBtn')?.addEventListener('click', () => {
    alert('EVACUATION BROADCAST CONFIRMED TO CENTRAL DISPATCH & ALL MINE HELMET BUZZERS!');
    document.getElementById('evacuationModal')?.classList.add('hidden');
  });

  // Camera Pan Controls
  document.getElementById('rPanLeft')?.addEventListener('click', () => {
    state.cameraPan = Math.max(-60, state.cameraPan - 15);
    playBeep(700, 'sine', 0.05);
  });
  document.getElementById('rPanRight')?.addEventListener('click', () => {
    state.cameraPan = Math.min(60, state.cameraPan + 15);
    playBeep(700, 'sine', 0.05);
  });
  document.getElementById('rSniffGas')?.addEventListener('click', () => {
    state.gasSnifferDeployed = !state.gasSnifferDeployed;
    alert(state.gasSnifferDeployed ? 'Gas Sniffer Probe Deployed! CH4 Sample: 0.82% at Pipe Joint B-2' : 'Gas Sniffer Retracted.');
    playBeep(900, 'sine', 0.1);
  });
  document.getElementById('rIrToggle')?.addEventListener('click', () => {
    state.irSpotlight = !state.irSpotlight;
    playBeep(800, 'sine', 0.05);
  });

  // Map Reset View
  document.getElementById('resetMapBtn')?.addEventListener('click', () => {
    playBeep(600, 'sine', 0.05);
    alert('Map View Reset to Full Mine Layout.');
  });
}

// Global functions for inline HTML button triggers
window.setCamMode = function(mode) {
  state.cameraMode = mode;
  playBeep(800, 'sine', 0.05);

  document.getElementById('btnModeThermal')?.classList.remove('active');
  document.getElementById('btnModeNight')?.classList.remove('active');
  document.getElementById('btnModeRGB')?.classList.remove('active');

  if (mode === 'thermal') document.getElementById('btnModeThermal')?.classList.add('active');
  if (mode === 'night') document.getElementById('btnModeNight')?.classList.add('active');
  if (mode === 'rgb') document.getElementById('btnModeRGB')?.classList.add('active');
};

window.acknowledgeAlert = function(btn) {
  playBeep(1000, 'sine', 0.1);
  const alertItem = btn.closest('.alert-item');
  if (alertItem) {
    alertItem.style.opacity = '0.6';
    btn.innerHTML = `<i data-lucide="check"></i> ACKNOWLEDGED`;
    btn.disabled = true;
    btn.style.background = 'rgba(255, 255, 255, 0.1)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    btn.style.color = '#94a3b8';
  }
};

window.focusZone = function(zoneName) {
  playBeep(700, 'sine', 0.05);
  const zoneSvg = document.querySelector(`[data-zone="${zoneName}"]`);
  if (zoneSvg) {
    zoneSvg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    zoneSvg.style.transition = 'transform 0.3s ease';
    zoneSvg.style.transform = 'scale(1.05)';
    setTimeout(() => { zoneSvg.style.transform = 'scale(1)'; }, 1000);
  }
};

window.escalateAlert = function(alertDesc) {
  playEmergencyHorn();
  alert(`ALERT ESCALATED TO MINEXA COMMAND DISPATCH: ${alertDesc}`);
};
