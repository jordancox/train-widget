# Get Quick Italian Train Times via Scriptable on iOS

<img width="660" height="470" alt="Screenshot 2025-09-24 at 14 13 43" src="https://github.com/user-attachments/assets/0554a3f6-27bd-41ff-8c0c-0df64fc7a0be" />

I take the train to work in Rome. It's six taps to open the Trenitalia app, get the station status I want, then get a list of all the trains going through that station, and then I have to spot mine in the list. Wanted to take that down to one fast tap when I'm on my way out of the apartment in the morning, or checking when I need to leave my desk at work.

This is a simple bit of javascript that you run in Scriptable, an iOS app, that does the API call and filters for the trains I want. Switches from morning to evening based on time of day.

Best option to call this from your iOS homescreen is via Shortcuts. Make a new scriptable shortcut that just runs the script, add it to your homescreen, and you'll get a little pop-up every time you tap it with your next 3 trains.

Obviously, for several days, this widget was showing mock data that I was using to conveniently miss several trains or spend an extra 10m at the station unnecessarily. When I finally got around to looking at a log or console or what have you in scriptable, there were several bugs that Claude (eventually) fixed. Now it (probably) works.

## Features Claude decided to add in which are all pretty good I must say

- **Auto-switching directions**: Morning outbound (Tuscolana → Muratella), Evening inbound (Muratella → Tuscolana)
- **Live train data**: Real-time departures from Viaggiatreno API
- **Smart urgency indicators**: Color-coded trains based on departure time
- **Peak hour awareness**: Shows relevant messaging during rush hours
- **Fallback mock data**: Works even when API is unavailable

## Installation

1. Download and install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) from the App Store
2. Copy the contents of `train-widget.js` into a new script in Scriptable
3. Customize the constants at the top of the file for your route
4. Add widget to your home screen, except it'll only update once every 15-30 minutes unless you tap it, and when you tap it, it opens scriptable. It's better to use Shortcuts and call it that way (just make a shortcut that runs scriptable and calls the script, no other instructions), add it to your home screen, and you get it in a little pop-over window with a big 'done' button to make it go away. One tap to see it, one tap to close it.

## Configuration

Edit the constants at the top of `train-widget.js` to customize for your route:

```javascript
// Station codes
const TUSCOLANA_CODE = 'S08408'; // Roma Tuscolana
const MURATELLA_CODE = 'S08400'; // Muratella
const FIUMICINO_CODE = 'S08000'; // Fiumicino Aeroporto

// Schedule configuration
const MORNING_CUTOFF = 14; // 2 PM - switch to evening schedule after this hour
const EVENING_CUTOFF = 22; // 10 PM - back to morning schedule after this

// Colors are set in the createWidget() function around line 247
```

### Finding Station Codes

Common Roman station codes:
- `S08408` - Roma Tuscolana
- `S08400` - Muratella
- `S08409` - Roma Ostiense
- `S08501` - Roma Trastevere
- `S08500` - Roma Termini
- `S08000` - Fiumicino Aeroporto

You can find more station codes by checking the official Viaggiatreno website or using the URL pattern in a browser to test different codes, says Claude. I don't know? You can try it out.

## Train Status Indicators

- 🏃‍♂️ **Urgent** (≤3 min): Red text - train leaving soon
- ⚡ **Soon** (≤8 min): Orange text - prepare to leave
- • **Normal** (≤15 min): White text - comfortable time
- • **Later** (>15 min): Gray text - plenty of time

## Customization that Claude decided to add. I have yet to change any of this to see if it works

### Different Routes
1. Find your station codes (see Finding Station Codes section)
2. Update station codes at the top of the file (lines 5-7)
3. Modify `AIRPORT_LINE_STATIONS` and `CITY_STATIONS` arrays (lines 14-32) for relevant destinations
4. Adjust schedule cutoff times if needed

### Visual Changes
- Modify background colors in `createWidget()` function (lines 247-251)
- Change emojis in `getCommuteDirection()` function (lines 45, 57, 68)
- Adjust urgency thresholds in `getUrgencyLevel()` function (lines 210-216)

### Schedule Adjustments
- Update `MORNING_CUTOFF` and `EVENING_CUTOFF` constants (lines 10-11)
- Modify mock schedule patterns in `getMockTrains()` function (lines 160-171)
- Adjust peak hour definitions (lines 192-193)

## API Reference

The widget uses the official Viaggiatreno mobile API:
- **Endpoint**: `http://www.viaggiatreno.it/infomobilitamobile/resteasy/viaggiatreno/partenze/{stationCode}/{dateString}`
- **Method**: GET
- **Date format**: JavaScript Date.toString() format (e.g., "Fri Jan 15 2025 14:30:00 GMT+0100")

## License

This project is provided as-is for personal use. Claude said it was following the Viaggiatreno API usage guidelines but I'm pretty sure it just made that up.
