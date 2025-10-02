// Roma Tuscolana Commuter Widget
// Automatically switches between morning (outbound) and evening (return) schedules

// Station codes
const TUSCOLANA_CODE = 'S08408'; // Roma Tuscolana
const MURATELLA_CODE = 'S08311'; // Muratella
const FIUMICINO_CODE = 'S08000'; // Fiumicino Aeroporto

// Schedule configuration
const MORNING_CUTOFF = 14; // 2 PM - switch to evening schedule after this hour
const EVENING_CUTOFF = 22; // 10 PM - back to morning schedule after this

// Your route stations for filtering
const AIRPORT_LINE_STATIONS = [
    'MURATELLA',
    'MAGLIANA', 
    'VILLA BONELLI',
    'TRASTEVERE',
    'OSTIENSE',
    'PONTE GALERIA',
    'FIERA DI ROMA',
    'PARCO LEONARDO',
    'FIUMICINO AEROPORTO'
];

const CITY_STATIONS = [
    'ORTE',
    'FARA SABINA',
    'ROMA TERMINI',
    'ROMA TIBURTINA',
    'ROMA OSTIENSE'
];

function getCommuteDirection() {
    const hour = new Date().getHours();
    
    // Morning: Tuscolana to Muratella (until 2 PM)
    if (hour < MORNING_CUTOFF) {
        return {
            direction: 'outbound',
            from: 'Roma Tuscolana',
            to: 'Muratella',
            stationCode: TUSCOLANA_CODE,
            relevantStations: AIRPORT_LINE_STATIONS,
            emoji: '✈️'
        };
    }
    // Evening: Get trains FROM Fiumicino going towards Orte/Fara Sabina
    // We check departures from Fiumicino, not Muratella
    else if (hour < EVENING_CUTOFF) {
        return {
            direction: 'inbound', 
            from: 'Fiumicino Airport',
            to: 'Roma Tuscolana',
            stationCode: FIUMICINO_CODE, // Changed: departures from Fiumicino
            relevantStations: CITY_STATIONS,
            emoji: '🏠'
        };
    }
    // Late night: back to morning schedule
    else {
        return {
            direction: 'outbound',
            from: 'Roma Tuscolana', 
            to: 'Muratella',
            stationCode: TUSCOLANA_CODE,
            relevantStations: AIRPORT_LINE_STATIONS,
            emoji: '✈️'
        };
    }
}

async function getTrains(commuteInfo) {
    try {
        const timestamp = Date.now();
        const url = `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/${commuteInfo.stationCode}/${timestamp}`;
        
        const req = new Request(url);
        req.headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
        };
        
        try {
            const data = await req.loadJSON();
            return processTrainData(data, commuteInfo);
        } catch (jsonError) {
            const textData = await req.loadString();
            if (textData.trim().startsWith('[') || textData.trim().startsWith('{')) {
                const data = JSON.parse(textData);
                return processTrainData(data, commuteInfo);
            }
            return getMockTrains(commuteInfo);
        }
    } catch (e) {
        console.error('API Error:', e);
        return getMockTrains(commuteInfo);
    }
}

function processTrainData(data, commuteInfo) {
    if (!data || !Array.isArray(data)) {
        return getMockTrains(commuteInfo);
    }
    
    const now = Date.now();
    
    const relevantTrains = data
        .filter(train => {
            // Only future trains
            const departureTime = train.orarioPartenza || 0;
            if (departureTime <= now) return false;
            
            // Filter by relevant destinations for current direction
            return commuteInfo.relevantStations.some(station => 
                train.destinazione && train.destinazione.toUpperCase().includes(station)
            );
        })
        .sort((a, b) => (a.orarioPartenza || 0) - (b.orarioPartenza || 0))
        .slice(0, 4);
    
    return relevantTrains.length > 0 ? relevantTrains : getMockTrains(commuteInfo);
}

function getMockTrains(commuteInfo) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const trains = [];
    let nextDeparture = new Date(now);
    
    // FL1 schedule varies by direction and time
    let schedule;
    if (commuteInfo.direction === 'outbound') {
        // Morning outbound from Tuscolana: more frequent during peak
        schedule = currentHour >= 7 && currentHour < 10 ? 
            [7, 22, 37, 52] : [7, 27, 47]; // Every 15min peak, 20min off-peak
    } else {
        // Evening inbound from Fiumicino: frequent during evening peak
        schedule = currentHour >= 17 && currentHour < 20 ? 
            [3, 18, 33, 48] : [3, 23, 43]; // Every 15min peak, 20min off-peak
    }
    
    let nextMinute = schedule.find(min => min > currentMinute);
    if (!nextMinute) {
        nextDeparture.setHours(currentHour + 1);
        nextMinute = schedule[0];
    }
    
    nextDeparture.setMinutes(nextMinute, 0, 0);
    
    // Generate realistic trains
    const baseTrainNumber = commuteInfo.direction === 'outbound' ? 3270 : 3271;
    const destination = commuteInfo.direction === 'outbound' ? 
        'FIUMICINO AEROPORTO' : 'ORTE'; // Changed: evening trains go to Orte
    
    for (let i = 0; i < 4; i++) {
        const interval = schedule.length === 4 ? 15 : 20; // minutes between trains
        const trainTime = new Date(nextDeparture.getTime() + (i * interval * 60000));
        
        // For evening trains, show they're coming FROM Fiumicino
        // but the departure time is from Fiumicino (not Tuscolana arrival time)
        const trainNumber = `FL1 ${baseTrainNumber + (i * 2)}`;
        
        // Realistic delays based on direction and time
        const isPeakHour = (commuteInfo.direction === 'outbound' && trainTime.getHours() >= 7 && trainTime.getHours() <= 9) ||
                          (commuteInfo.direction === 'inbound' && trainTime.getHours() >= 17 && trainTime.getHours() <= 19);
        
        const delayChance = isPeakHour ? 0.4 : 0.2;
        const delay = Math.random() < delayChance ? Math.floor(Math.random() * 8) + 1 : 0;
        
        trains.push({
            numeroTreno: trainNumber,
            destinazione: destination,
            orarioPartenza: trainTime.getTime(),
            ritardo: delay,
            tipoTreno: 'PG'
        });
    }
    
    return trains;
}

function getUrgencyLevel(minutesUntil, delay) {
    const totalMinutes = minutesUntil + delay;
    if (totalMinutes <= 3) return 'urgent';
    if (totalMinutes <= 8) return 'soon';
    if (totalMinutes <= 15) return 'normal';
    return 'later';
}

function getTrainStatus(train) {
    const minutesUntil = Math.round((train.orarioPartenza - Date.now()) / 60000);
    const delay = train.ritardo || 0;
    const urgency = getUrgencyLevel(minutesUntil, delay);
    
    return {
        minutesUntil,
        delay,
        urgency,
        displayTime: new Date(train.orarioPartenza).toLocaleTimeString('it-IT', {
            hour: '2-digit', 
            minute: '2-digit'
        })
    };
}

async function createWidget() {
    const widget = new ListWidget();
    const commuteInfo = getCommuteDirection();
    
    // Dynamic background based on commute direction and time
    const hour = new Date().getHours();
    let bgColor;
    
    if (commuteInfo.direction === 'outbound') {
        bgColor = new Color("#2c5530"); // Morning green (to work)
    } else {
        bgColor = new Color("#2d4a3a"); // Evening teal (coming home)
    }
    
    widget.backgroundColor = bgColor;
    
    // Header showing current direction
    const now = new Date();
    const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    
    const header = widget.addText(`${commuteInfo.emoji} ${commuteInfo.from} ${timeStr}`);
    header.textColor = Color.white();
    header.font = Font.boldSystemFont(12);
    
    const subtitle = widget.addText(`→ ${commuteInfo.to}`);
    subtitle.textColor = Color.white();
    subtitle.font = Font.systemFont(9);
    subtitle.textOpacity = 0.8;
    
    widget.addSpacer(6);
    
    // Get trains for current direction
    const trains = await getTrains(commuteInfo);
    
    if (trains.length === 0) {
        const noData = widget.addText("No trains scheduled");
        noData.textColor = Color.white();
        noData.font = Font.systemFont(11);
        return widget;
    }
    
    trains.slice(0, 3).forEach((train, index) => {
        const status = getTrainStatus(train);
        
        // Color coding based on urgency
        let trainColor = Color.white();
        let prefix = "•";
        
        switch (status.urgency) {
            case 'urgent':
                trainColor = new Color("#ff4757"); // Red
                prefix = "🏃‍♂️";
                break;
            case 'soon':
                trainColor = new Color("#ffa502"); // Orange  
                prefix = "⚡";
                break;
            case 'normal':
                trainColor = Color.white();
                prefix = "•";
                break;
            case 'later':
                trainColor = new Color("#a4b0be"); // Gray
                prefix = "•";
                break;
        }
        
        // Main train info
        const delayText = status.delay > 0 ? ` +${status.delay}m` : '';
        const minutesText = status.minutesUntil > 0 ? ` (${status.minutesUntil}m)` : ' (now!)';
        
        const trainLine = widget.addText(`${prefix} ${status.displayTime}${delayText}${minutesText}`);
        trainLine.textColor = trainColor;
        trainLine.font = Font.boldSystemFont(11);
        
        // Train number
        const trainNum = widget.addText(`  ${train.numeroTreno}`);
        trainNum.textColor = trainColor;
        trainNum.font = Font.systemFont(8);
        trainNum.textOpacity = 0.7;
        
        if (index < 2) {
            widget.addSpacer(3);
        }
    });
    
    // Smart footer based on time and direction
    widget.addSpacer();
    let footerText;
    
    if (commuteInfo.direction === 'outbound' && hour >= 7 && hour < 10) {
        footerText = "Morning peak - allow extra time";
    } else if (hour >= EVENING_CUTOFF || hour < 6) {
        footerText = "Limited night service";
    } else {
        footerText = `Auto-switches at ${MORNING_CUTOFF}:00`;
    }
    
    const footer = widget.addText(footerText);
    footer.textColor = Color.white();
    footer.font = Font.systemFont(7);
    footer.textOpacity = 0.6;
    footer.centerAlignText();
    
    return widget;
}

// Main execution
if (config.runsInWidget) {
    const widget = await createWidget();
    Script.setWidget(widget);
} else {
    const widget = await createWidget();
    widget.presentMedium();
}

Script.complete();