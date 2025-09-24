# Get Quick Italian Train Times via Scriptable on iOS

<img width="660" height="470" alt="Screenshot 2025-09-24 at 14 13 43" src="https://github.com/user-attachments/assets/0554a3f6-27bd-41ff-8c0c-0df64fc7a0be" />

I take the train to work in Rome. It's six taps to open the Trenitalia app, get the station status I want, then get a list of all the trains going through that station, and then I have to spot mine in the list. Wanted to take that down to one fast tap when I'm on my way out of the apartment in the morning, or checking when I need to leave my desk at work.

This is a simple bit of javascript that you run in Scriptable, an iOS app, that does the API call and filters for the trains I want. Switches from morning to evening based on time of day.

Best option to call this from your iOS homescreen is via Shortcuts. Make a new scriptable shortcut that just runs the script, add it to your homescreen, and you'll get a little pop-up every time you tap it with your next 3 trains.

## Features Claude decided to add in which are all pretty good I must say

- **Auto-switching directions**: Morning outbound (Tuscolana → Muratella), Evening inbound (Muratella → Tuscolana)
- **Live train data**: Real-time departures from Viaggiatreno API
- **Smart urgency indicators**: Color-coded trains based on departure time
- **Peak hour awareness**: Shows relevant messaging during rush hours
- **Fallback mock data**: Works even when API is unavailable

## Installation

1. Download and install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) from the App Store
2. Copy the contents of `train-widget.js` into a new script in Scriptable
3. Customize the CONFIG section at the top of the file for your route
4. Add widget to your home screen, except it'll only update once every 15-30 minutes unless you tap it, and when you tap it, it opens scriptable. It's better to use Shortcuts and call it that way (just make a shortcut that runs scriptable and calls the script, no other instructions), add it to your home screen, and you get it in a little pop-over window with a big 'done' button to make it go away. One tap to see it, one tap to close it.

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

Common Roman station codes:
- `S08408` - Roma Tuscolana
- `S08311` - Muratella  
- `S08409` - Roma Ostiense
- `S08501` - Roma Trastevere
- `S08500` - Roma Termini

You can find more station codes by checking the official Viaggiatreno website or using the URL pattern in a browser to test different codes, says Claude. I don't know? You can try it out.

## Train Status Indicators

- 🏃‍♂️ **Urgent** (≤3 min): Red text - train leaving soon
- ⚡ **Soon** (≤8 min): Orange text - prepare to leave
- • **Normal** (≤15 min): White text - comfortable time
- • **Later** (>15 min): Gray text - plenty of time

## Customization that Claude decided to add. I have yet to change any of this to see if it works

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

## License

This project is provided as-is for personal use. Claude said it was following the Viaggiatreno API usage guidelines but I'm pretty sure it just made that up.
