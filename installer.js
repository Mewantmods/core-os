const fill = document.getElementById("fill");
const log = document.getElementById("log");

let progress = 0;

const steps = [
    "Verifying developer credentials",
    "Downloading kernel modules",
    "Installing Core runtime",
    "Configuring secure environment",
    "Applying developer-only flags",
    "Finalizing installation"
];

let stepIndex = 0;

const interval = setInterval(() => {
    progress += Math.random() * 8;
    if (progress > 100) progress = 100;

    fill.style.width = progress + "%";

    if (stepIndex < steps.length && progress > (stepIndex + 1) * 15) {
        log.innerHTML += `> ${steps[stepIndex]}<br>`;
        stepIndex++;
    }

    if (progress >= 100) {
        log.innerHTML += "> Core OS installation complete.<br>";
        clearInterval(interval);
    }
}, 700);
