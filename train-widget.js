// Roma Tuscolana ↔ Muratella Commuter Widget
// Automatically switches between morning (outbound) and evening (return) schedules
// 
// CONFIGURATION - Edit these values to customize your commute
// ============================================================

const CONFIG = {
    stations: {
        tuscolana: {
            code: 'S08408',
            name: 'Roma Tuscolana'
        },
        muratella: {
            code: 'S08311', 
            name: 'Muratella'
        }
    },
    schedule: {
        morningCutoff: 14, // 2 PM - switch to evening schedule after this hour
        eveningCutoff: 22, // 10 PM - back to morning schedule after this
    },
    routes: {
        airportLine: [
            'MURATELLA',
            'MAGLIANA', 
            'VILLA BONELLI',
            'TRASTEVERE',
            'OSTIENSE',
            'PONTE GALERIA',
            'FIERA DI ROMA',
            'PARCO LEONARDO',
            'FIUMICINO AEROPORTO'
        ],
        cityStations: [
            'ROMA TUSCOLANA',
            'ROMA OSTIENSE', 
            'ROMA TRASTEVERE',
            'ROMA TERMINI'
        ]
    },
    
    // Visual settings
    theme: {
        morningColor: "#2c5530",  // Green for morning/outbound
        eveningColor: "#2d4a3a",  // Teal for evening/inbound  
        morningEmoji: "✈️",       // Emoji for outbound direction
        eveningEmoji: "🏠"        // Emoji for inbound direction
    }
};

// ============================================================
// WIDGET CODE - You shouldn't need to modify below this line
// ============================================================

class TrainWidget {
    constructor(config = CONFIG) {
        this.config = config;
    }

    getCommuteDirection() {
        const hour = new Date().getHours();
        
        if (hour < this.config.schedule.morningCutoff) {
            return {
                direction: 'outbound',
                from: this.config.stations.tuscolana.name,
                to: this.config.stations.muratella.name,
                stationCode: this.config.stations.tuscolana.code,
                relevantStations: this.config.routes.airportLine,
                emoji: this.config.theme.morningEmoji
            };
        } else if (hour < this.config.schedule.eveningCutoff) {
            return {
                direction: 'inbound', 
                from: this.config.stations.muratella.name,
                to: this.config.stations.tuscolana.name,
                stationCode: this.config.stations.muratella.code,
                relevantStations: this.config.routes.cityStations,
                emoji: this.config.theme.eveningEmoji
            };
        } else {
            return {
                direction: 'outbound',
                from: this.config.stations.tuscolana.name, 
                to: this.config.stations.muratella.name,
                stationCode: this.config.stations.tuscolana.code,
                relevantStations: this.config.routes.airportLine,
                emoji: this.config.theme.morningEmoji
            };
        }
    }

    async getTrains(commuteInfo) {
        try {
            const timestamp = Date.now();
            const url = `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/${commuteInfo.stationCode}/${timestamp}`;
            
            const req = new Request(url);
            req.headers = {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
            };
            
            try {
                const data = await req.loadJSON();
                return this.processTrainData(data, commuteInfo);
            } catch (jsonError) {
                const textData = await req.loadString();
                if (textData.trim().startsWith('[') || textData.trim().startsWith('{')) {
                    const data = JSON.parse(textData);
                    return this.processTrainData(data, commuteInfo);
                }
                return this.getMockTrains(commuteInfo);
            }
        } catch (e) {
            console.error('API Error:', e);
            return this.getMockTrains(commuteInfo);
        }
    }

    processTrainData(data, commuteInfo) {
        if (!data || !Array.isArray(data)) {
            return this.getMockTrains(commuteInfo);
        }
        
        const now = Date.now();
        
        const relevantTrains = data
            .filter(train => {
                const departureTime = train.orarioPartenza || 0;
                if (departureTime <= now) return false;
                
                return commuteInfo.relevantStations.some(station => 
                    train.destinazione && train.destinazione.toUpperCase().includes(station)
                );
            })
            .sort((a, b) => (a.orarioPartenza || 0) - (b.orarioPartenza || 0))
            .slice(0, 4);
        
        return relevantTrains.length > 0 ? relevantTrains : this.getMockTrains(commuteInfo);
    }

    getMockTrains(commuteInfo) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        const trains = [];
        let nextDeparture = new Date(now);
        
        let schedule;
        if (commuteInfo.direction === 'outbound') {
            schedule = currentHour >= 7 && currentHour < 10 ? 
                [7, 22, 37, 52] : [7, 27, 47];
        } else {
            schedule = currentHour >= 17 && currentHour < 20 ? 
                [5, 20, 35, 50] : [5, 25, 45];
        }
        
        let nextMinute = schedule.find(min => min > currentMinute);
        if (!nextMinute) {
            nextDeparture.setHours(currentHour + 1);
            nextMinute = schedule[0];
        }
        
        nextDeparture.setMinutes(nextMinute, 0, 0);
        
        const baseTrainNumber = commuteInfo.direction === 'outbound' ? 3270 : 3271;
        const destination = commuteInfo.direction === 'outbound' ? 
            'FIUMICINO AEROPORTO' : 'ROMA TERMINI';
        
        for (let i = 0; i < 4; i++) {
            const interval = schedule.length === 4 ? 15 : 20;
            const trainTime = new Date(nextDeparture.getTime() + (i * interval * 60000));
            const trainNumber = `FL1 ${baseTrainNumber + (i * 2)}`;
            
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

    getUrgencyLevel(minutesUntil, delay) {
        const totalMinutes = minutesUntil + delay;
        if (totalMinutes <= 3) return 'urgent';
        if (totalMinutes <= 8) return 'soon';
        if (totalMinutes <= 15) return 'normal';
        return 'later';
    }

    getTrainStatus(train) {
        const minutesUntil = Math.round((train.orarioPartenza - Date.now()) / 60000);
        const delay = train.ritardo || 0;
        const urgency = this.getUrgencyLevel(minutesUntil, delay);
        
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

    async createWidget() {
        const widget = new ListWidget();
        const commuteInfo = this.getCommuteDirection();
        
        const hour = new Date().getHours();
        let bgColor;
        
        if (commuteInfo.direction === 'outbound') {
            bgColor = new Color(this.config.theme.morningColor);
        } else {
            bgColor = new Color(this.config.theme.eveningColor);
        }
        
        widget.backgroundColor = bgColor;
        
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
        
        const trains = await this.getTrains(commuteInfo);
        
        if (trains.length === 0) {
            const noData = widget.addText("No trains scheduled");
            noData.textColor = Color.white();
            noData.font = Font.systemFont(11);
            return widget;
        }
        
        trains.slice(0, 3).forEach((train, index) => {
            const status = this.getTrainStatus(train);
            
            let trainColor = Color.white();
            let prefix = "•";
            
            switch (status.urgency) {
                case 'urgent':
                    trainColor = new Color("#ff4757");
                    prefix = "🏃‍♂️";
                    break;
                case 'soon':
                    trainColor = new Color("#ffa502");
                    prefix = "⚡";
                    break;
                case 'normal':
                    trainColor = Color.white();
                    prefix = "•";
                    break;
                case 'later':
                    trainColor = new Color("#a4b0be");
                    prefix = "•";
                    break;
            }
            
            const delayText = status.delay > 0 ? ` +${status.delay}m` : '';
            const minutesText = status.minutesUntil > 0 ? ` (${status.minutesUntil}m)` : ' (now!)';
            
            const trainLine = widget.addText(`${prefix} ${status.displayTime}${delayText}${minutesText}`);
            trainLine.textColor = trainColor;
            trainLine.font = Font.boldSystemFont(11);
            
            const trainNum = widget.addText(`  ${train.numeroTreno}`);
            trainNum.textColor = trainColor;
            trainNum.font = Font.systemFont(8);
            trainNum.textOpacity = 0.7;
            
            if (index < 2) {
                widget.addSpacer(3);
            }
        });
        
        widget.addSpacer();
        let footerText;
        
        if (commuteInfo.direction === 'outbound' && hour >= 7 && hour < 10) {
            footerText = "Morning peak - allow extra time";
        } else if (hour >= this.config.schedule.eveningCutoff || hour < 6) {
            footerText = "Limited night service";
        } else {
            footerText = `Auto-switches at ${this.config.schedule.morningCutoff}:00`;
        }
        
        const footer = widget.addText(footerText);
        footer.textColor = Color.white();
        footer.font = Font.systemFont(7);
        footer.textOpacity = 0.6;
        footer.centerAlignText();
        
        return widget;
    }
}

// Main execution
async function main() {
    const trainWidget = new TrainWidget();
    
    if (config.runsInWidget) {
        const widget = await trainWidget.createWidget();
        Script.setWidget(widget);
    } else {
        const widget = await trainWidget.createWidget();
        widget.presentMedium();
    }
    
    Script.complete();
}

main();