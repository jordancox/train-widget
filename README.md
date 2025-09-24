# Italian Train Widget for iOS Scriptable

A smart commuter widget for Italian trains that automatically switches between morning and evening directions based on time of day. Built specifically for the Roma Tuscolana ↔ Muratella route using FL1 line data.

## Features

- **Auto-switching directions**: Morning outbound (Tuscolana → Muratella), Evening inbound (Muratella → Tuscolana)
- **Live train data**: Real-time departures from Viaggiatreno API
- **Smart urgency indicators**: Color-coded trains based on departure time
- **Peak hour awareness**: Shows relevant messaging during rush hours
- **Fallback mock data**: Works even when API is unavailable

## Installation

1. Download and install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) from the App Store
2. Copy the contents of `train-widget.js` into a new script in Scriptable
3. Customize the CONFIG section at the top of the file for your route
4. Add widget to your home screen

**Note**: Scriptable requires all code in a single file. The `train-widget.js` file contains everything needed, with configuration at the top for easy editing.

### Setting up the Widget

1. Long press on your home screen and tap the "+" button
2. Search for "Scriptable" and select the medium widget size
3. Add the widget to your home screen
4. Tap on the widget to configure it
5. Select "train-widget" as the script
6. The widget will automatically refresh throughout the day

## Configuration

Edit the CONFIG section at the top of `train-widget.js` to customize for your route:

```javascript
const CONFIG = {
    stations: {
        tuscolana: {
            code: 'S08408',      // Your departure station code
            name: 'Roma Tuscolana'
        },
        muratella: {
            code: 'S08311',      // Your arrival station code
            name: 'Muratella'
        }
    },
    
    schedule: {
        morningCutoff: 14,   // Hour to switch directions (24h format)
        eveningCutoff: 22,   // Hour to switch back
    },
    
    theme: {
        morningColor: "#2c5530",  // Colors and emojis
        eveningColor: "#2d4a3a",
        morningEmoji: "✈️",
        eveningEmoji: "🏠"
    }
    // ... more options in the file
};
```

### Finding Station Codes

Common Italian station codes:
- `S08408` - Roma Tuscolana
- `S08311` - Muratella  
- `S08409` - Roma Ostiense
- `S08501` - Roma Trastevere
- `S08500` - Roma Termini

You can find more station codes by checking the official Viaggiatreno website or using the URL pattern in a browser to test different codes.

## File Structure

```
train-widget/
├── train-widget.js    # Main widget code (single file for Scriptable)
├── README.md          # This documentation
└── .gitignore         # Version control setup
```

Clean and simple - just copy `train-widget.js` into Scriptable and you're ready to go!

## Widget Behavior

### Morning Mode (until 2 PM)
- Shows outbound trains (Tuscolana → Muratella)
- Green theme color
- Airplane emoji ✈️
- Filters for airport line destinations

### Evening Mode (2 PM - 10 PM)
- Shows inbound trains (Muratella → Tuscolana)
- Teal theme color  
- House emoji 🏠
- Filters for city center destinations

### Late Night Mode (after 10 PM)
- Returns to morning mode
- Shows "Limited night service" message

## Train Status Indicators

- 🏃‍♂️ **Urgent** (≤3 min): Red text - train leaving soon
- ⚡ **Soon** (≤8 min): Orange text - prepare to leave
- • **Normal** (≤15 min): White text - comfortable time
- • **Later** (>15 min): Gray text - plenty of time

## Testing & Debugging

To test if your station codes work:

1. Run the widget in Scriptable (not as a home screen widget)
2. Check the console for any API errors
3. Try different station codes in the CONFIG section
4. Test the API URL manually in a browser: `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/S08408/1234567890`

## Troubleshooting

### Widget shows "No trains scheduled"
- Check if the station codes are correct
- Test the API URL manually in a browser
- Check if current time has scheduled trains

### Wrong direction showing
- Verify `morningCutoff` and `eveningCutoff` times in config
- Check device time zone settings

### API errors
- The widget includes fallback mock data
- Mock data simulates realistic FL1 schedules
- Check internet connection if real data is needed

## Customization

### Different Routes
1. Find your station codes (see Finding Station Codes section)
2. Update station codes in the CONFIG section
3. Modify route filters for relevant destinations
4. Adjust schedule cutoff times if needed

### Visual Changes
- Modify theme colors in the CONFIG section
- Change emojis for different directions
- Adjust urgency thresholds in the widget code

### Schedule Adjustments
- Update `morningCutoff` and `eveningCutoff` times
- Modify mock schedule patterns for your route
- Adjust peak hour definitions

## API Reference

The widget uses the official Viaggiatreno API:
- **Endpoint**: `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/{stationCode}/{timestamp}`
- **Method**: GET
- **Headers**: User-Agent required for iOS compatibility

## Version Control Ready

This project includes:
- Clean separation of configuration and code
- Modular architecture for easy maintenance  
- Testing utilities for validation
- Documentation for setup and customization

Ready to commit to your preferred version control system.

## License

This project is provided as-is for personal use. Trenitalia API usage follows their terms of service.