document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const screens = {
        start: document.getElementById('screen-start'),
        add: document.getElementById('screen-add'),
        result: document.getElementById('screen-result')
    };

    const buttons = {
        add: document.getElementById('btn-add-task'),
        cancelAdd: document.getElementById('btn-cancel-add'),
        approve: document.getElementById('btn-approve'),
        adjust: document.getElementById('btn-adjust')
    };

    const taskForm = document.getElementById('form-add-task');
    const taskList = document.getElementById('task-list');
    const weekCalendar = document.getElementById('week-calendar');
    const planContainer = document.getElementById('generated-plan');
    const formError = document.getElementById('form-error');

    // State & Data Migration
    let tasks = [];
    try {
        const rawData = localStorage.getItem('tasks');
        const parsed = JSON.parse(rawData) || [];
        // Force-regenerate all tasks to ensure they are conflict-free
        const tempTasks = [];
        parsed.forEach(t => {
            t.slots = generateAIPlanSlots(t.name, t.prep, new Date(t.deadline), tempTasks);
            tempTasks.push(t);
        });
        tasks = tempTasks;
        localStorage.setItem('tasks', JSON.stringify(tasks));
    } catch (e) {
        tasks = [];
    }

    let currentPendingTask = null;

    // Initialization
    renderTaskList();
    renderCalendar();

    // Event Listeners
    buttons.add.addEventListener('click', () => switchScreen('add'));
    buttons.cancelAdd.addEventListener('click', () => switchScreen('start'));

    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('task-name').value;
        const desc = document.getElementById('task-desc').value;
        const prep = parseInt(document.getElementById('task-prep').value);
        const deadline = document.getElementById('task-deadline').value;

        if (!name || !deadline || isNaN(prep)) {
            showError("Naam, deadline en voorbereidingstijd zijn verplicht.");
            return;
        }

        const deadlineDate = new Date(deadline);
        deadlineDate.setHours(23, 59, 59);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (deadlineDate < today) {
            showError("De deadline kan niet in het verleden liggen.");
            return;
        }

        formError.classList.add('hidden');

        // Use existing tasks to find free slots
        const slots = generateAIPlanSlots(name, prep, deadlineDate, tasks);

        currentPendingTask = {
            id: Date.now(),
            name,
            desc,
            prep,
            deadline,
            slots,
            createdAt: new Date().toISOString()
        };

        renderPlanPreview(slots);
        switchScreen('result');
    });

    buttons.approve.addEventListener('click', () => {
        if (currentPendingTask) {
            tasks.push(currentPendingTask);
            saveTasks();
            renderTaskList();
            renderCalendar();
            switchScreen('start');
            currentPendingTask = null;
            taskForm.reset();
        }
    });

    buttons.adjust.addEventListener('click', () => {
        switchScreen('add');
    });

    // Functions
    function switchScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName].classList.add('active');
        if (screenName === 'start') {
            buttons.add.style.display = 'flex';
        } else {
            buttons.add.style.display = 'none';
        }
    }

    function showError(msg) {
        formError.textContent = msg;
        formError.classList.remove('hidden');
    }

    function saveTasks() {
        localStorage.setItem('tasks', JSON.stringify(tasks));
    }

    function renderTaskList() {
        taskList.innerHTML = tasks.length === 0 ?
            '<div class="empty-state"><p>Nog geen taken toegevoegd. Begin met plannen!</p></div>' :
            tasks.map(task => `
                <div class="task-item">
                    <div class="task-info">
                        <h4>${task.name}</h4>
                        <div class="task-meta">Deadline: ${task.deadline} • ${task.prep} min</div>
                    </div>
                </div>
            `).join('');
    }

    function renderCalendar() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfWeek = new Date(today);
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);

        weekCalendar.innerHTML = '';
        const dayNames = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(startOfWeek);
            currentDay.setDate(startOfWeek.getDate() + i);
            const dateStr = currentDay.toISOString().split('T')[0];
            const isToday = currentDay.toDateString() === today.toDateString();

            const studySlots = tasks.flatMap(t => t.slots || []).filter(s => s.date === dateStr);
            const todayDeadlines = tasks.filter(t => t.deadline === dateStr);

            let indicatorsHtml = '';

            todayDeadlines.forEach(t => {
                indicatorsHtml += `
                    <div class="cal-slot deadline" title="Deadline: ${t.name}">
                        <span class="time">DEADLINE</span>
                        ${t.name}
                    </div>
                `;
            });

            studySlots.sort((a, b) => a.startTime.localeCompare(b.startTime)).forEach(s => {
                indicatorsHtml += `
                    <div class="cal-slot">
                        <span class="time">${s.startTime} (${s.duration} min)</span>
                        ${s.taskName}
                    </div>
                `;
            });

            dayEl = document.createElement('div');
            dayEl.className = `cal-day ${isToday ? 'today' : ''}`;
            dayEl.innerHTML = `
                <div class="day-header">
                    <span class="day-name">${dayNames[i]}</span>
                    <span class="day-num">${currentDay.getDate()}</span>
                </div>
                <div class="day-indicators">
                    ${indicatorsHtml}
                </div>
            `;
            weekCalendar.appendChild(dayEl);
        }
    }

    /**
     * Conflict-Free Planning Logic
     */
    function generateAIPlanSlots(name, prep, deadline, existingTasks) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const slots = [];
        const diffMs = deadline - today;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const daysToSpread = Math.max(1, Math.min(diffDays, 7));
        const minutesPerDay = Math.ceil(prep / daysToSpread);

        // Gather all existing slots to check for overlaps
        const allExistingSlots = existingTasks.flatMap(t => t.slots || []);

        for (let i = 0; i < daysToSpread; i++) {
            const planDate = new Date(today);
            planDate.setDate(today.getDate() + i + 1);
            if (planDate > deadline) continue;

            const dateStr = planDate.toISOString().split('T')[0];

            // Default start time is 16:00
            let startHour = 16;
            let startMin = 0;

            // Simple collision detection loop
            let collision = true;
            while (collision) {
                const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

                // Check if this time slot is already taken on this day
                // We consider a slot "taken" if it overlaps with any existing slot duration
                const isOverlapping = allExistingSlots.some(s => {
                    if (s.date !== dateStr) return false;

                    // Convert hours to minutes for easier math
                    const existingStart = timeToMinutes(s.startTime);
                    const existingEnd = existingStart + s.duration;
                    const newStart = (startHour * 60) + startMin;
                    const newEnd = newStart + minutesPerDay;

                    // Standard overlap check: (StartA < EndB) && (EndA > StartB)
                    return (newStart < existingEnd) && (newEnd > existingStart);
                });

                if (isOverlapping) {
                    // Shift by 30 minutes and try again
                    startMin += 30;
                    if (startMin >= 60) {
                        startMin = 0;
                        startHour += 1;
                    }
                    if (startHour > 22) {
                        // Too late, move to next day or just stack (fail-safe)
                        collision = false;
                    }
                } else {
                    collision = false;
                    slots.push({
                        taskName: name,
                        date: dateStr,
                        startTime: startTimeStr,
                        duration: minutesPerDay,
                        label: planDate.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' })
                    });
                }
            }
        }

        if (slots.length === 0) {
            slots.push({
                taskName: name,
                date: today.toISOString().split('T')[0],
                startTime: '16:00',
                duration: prep,
                label: 'Vandaag'
            });
        }

        return slots;
    }

    function timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return (h * 60) + m;
    }

    function renderPlanPreview(slots) {
        planContainer.innerHTML = slots.map(slot => `
            <div class="plan-slot">
                <div class="slot-time">${slot.label} • ${slot.startTime} - ${formatTime(slot.startTime, slot.duration)}</div>
                <div class="slot-label">Focus: ${slot.taskName} voorbereiding (${slot.duration} min)</div>
            </div>
        `).join('');
    }

    function formatTime(startTimeStr, durationMin) {
        const [h, m] = startTimeStr.split(':').map(Number);
        const totalMinutes = (h * 60) + m + durationMin;
        const endHour = Math.floor(totalMinutes / 60) % 24;
        const endMin = totalMinutes % 60;
        return `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
    }
});
