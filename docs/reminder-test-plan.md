# Aidha reminder test plan

Manual test plan for Aidha's reminders, run on your own iPhone with the **Aidha (Dev)** build.
Plan on **about 45 minutes**, most of it waiting. The batches are designed so you create
several tasks up front and let them fire while you do other things.

## How reminders work (what you're testing)

| Reminder | Fires | Looks like |
|---|---|---|
| **At the time** | At the task's / event's own time | Title = the task title, body = its location (if any) |
| **Time to leave** | At "leaving by" = event time - travel time - 8 min buffer. Only for items with a **location and a time** | Title "Time to leave for *X*", body "*Place* - about *N* min away" |
| **Live Activity** | Pushed by the server once "leaving by" is **within 15 min** (checked every minute) | Lock-screen / Dynamic Island card with a "LEAVE IN" countdown ring |

At-the-time and time-to-leave are **local notifications scheduled on the phone**. They fire even if
the app is closed. The Live Activity comes from a server job that runs once a minute.

## Setup (do once)

- [ ] **S1.** Dev server running: `cd aidha && npx expo start --dev-client`. Open **Aidha (Dev)** on the phone, signed in.
- [ ] **S2. Notifications:** Settings -> Notifications -> Aidha (Dev) -> **Allow**, Banners **on**. Turn **Focus / Do Not Disturb off**.
  (Silent switch on = banners still show, just no sound.)
- [ ] **S3. Location:** Settings -> Privacy & Security -> Location Services -> Aidha (Dev) -> **While Using the App**, Precise Location **on**.
- [ ] **S4.** Phone clock set to automatic. Note the current time. Below, **T** means "now", so *T+5* is five minutes from now.
- [ ] **S5.** Pick **PLACE**: somewhere real, **5-10 minutes** from where you'll be (a cafe, a shop).
- [ ] **S6. (Live Activity only)** Settings -> Aidha (Dev) -> **Live Activities** on. In the Supabase dashboard, check the `device_push_tokens` table has a row for your user. No row means the Live Activity tests can't work yet.

### Creating test items quickly

Tap **+**, type the text, **Send**, answer follow-ups, tap the green check to save.
- **Task:** `Test A today at 4:47 PM` -> when asked priority, tap **Low**.
- **Event:** `Test event today at 5:10 PM` -> when asked where, type **PLACE** (or tap a suggestion).
- Always give an **exact clock time**. Check the card shows the time you meant before saving.
- The first save asks permission to send notifications: tap **Allow**.

---

## Batch 1: "At the time" reminders (about 10 min)

Create all four **now**, one minute apart, then put the phone in each state.

| Task | Time |
|---|---|
| `Test A foreground` | T+4 |
| `Test B background` | T+5 |
| `Test C locked` | T+6 |
| `Test D quit` | T+7 |

Then, before T+4:
- **A:** leave Aidha open on the Today tab.
- **B:** press Home so Aidha is in the background.
- **C:** lock the phone.
- **D:** swipe Aidha away in the app switcher (force quit), then lock or leave it.

| ID | What to check | Expected | Result |
|---|---|---|---|
| **1.1** | Permission prompt on the first save | iOS asks to allow notifications; you tap Allow | ☐ |
| **1.2** | **A** at T+4 (app open) | A banner "Test A foreground" drops down **inside the app** | ☐ |
| **1.3** | **B** at T+5 (backgrounded) | Banner "Test B background". Tapping it opens Aidha | ☐ |
| **1.4** | **C** at T+6 (locked) | Lock-screen notification "Test C locked" | ☐ |
| **1.5** | **D** at T+7 (force-quit) | Notification "Test D quit" still arrives | ☐ |
| **1.6** | Timing | Each lands **within a few seconds** of its time, not a minute late | ☐ |
| **1.7** | Each fires **once** | No duplicates | ☐ |

---

## Batch 2: "Time to leave" reminders (about 30 min, run alongside the others)

Needs location access (S3) and a real **PLACE**.

Create: `Test leave-by today at T+25` (event, location = PLACE).

| ID | What to check | Expected | Result |
|---|---|---|---|
| **2.1** | After saving, open the item (Today -> tap it) | The edit screen shows a **Leaving by** time and a travel time. Leaving by is roughly **event time - travel time - 8 min**. Write it down: ____ | ☐ |
| **2.2** | At that "Leaving by" time (app closed or backgrounded) | Notification **"Time to leave for Test leave-by"**, body "*PLACE* - about *N* min away" | ☐ |
| **2.3** | At the event time (T+25) | A **second** notification titled "Test leave-by" with PLACE as the body | ☐ |
| **2.4** | Today screen shortly before leaving by | The "next up" card says **Leave in N min**, matching 2.1 | ☐ |
| **2.5** | Open Aidha within 90 min of the event | "Leaving by" may shift slightly. That's expected: it's re-checked from where you are now | ☐ |

---

## Batch 3: Changing and removing reminders

Each needs a task 8+ minutes out so you have time to change it. Create them all now.

| Task | Time |
|---|---|
| `Test C1 move later` | T+8 |
| `Test C2 move earlier` | T+14 |
| `Test C3 complete` | T+8 |
| `Test C4 delete` | T+8 |
| `Test C5 snooze` | T+8 |

| ID | Action (do it before the task's time) | Expected | Result |
|---|---|---|---|
| **3.1** | **C1:** open it -> Time -> change to **T+11** -> Save | **Nothing** at T+8. One notification at T+11 | ☐ |
| **3.2** | **C2:** open it -> Time -> change to **T+10** -> Save | One notification at T+10. **Nothing** at the old T+14 | ☐ |
| **3.3** | **C3:** mark it done (check on Today / Tasks) | **Nothing** fires at T+8 | ☐ |
| **3.4** | **C4:** open it -> trash icon -> confirm | **Nothing** fires at T+8 | ☐ |
| **3.5** | **C5:** on Today, tap the item's snooze pill -> **1 hour** | Its time moves forward an hour. **Nothing** at T+8. A notification arrives at T+68 *(optional: wait, or check it the next time you pass)* | ☐ |
| **3.6** | Change a **location**: in the `Test leave-by` event (before leaving by), change the place to somewhere with a clearly different travel time | "Leaving by" updates. Only the **new** leave-by notification fires, not the old one | ☐ |

---

## Batch 4: Recurring items and archiving

| ID | Steps | Expected | Result |
|---|---|---|---|
| **4.1** | Create `Test daily today at T+4, every day`. When it fires, mark it done on Today | A **new copy for tomorrow**, same time, appears (Tasks -> Recurring). *Optional: check it fires tomorrow at that time* | ☐ |
| **4.2** | Create event `Test archive today at T+3` with **no duration**. After it fires, open Today | The event is gone from Today and appears under **Tasks -> Archive**. Nothing further fires | ☐ |
| **4.3** | Create event `Test duration today at T+2 for 10 minutes`. Watch Today at T+3 | Shown as **Happening now - until (time)**, **not** as Overdue. After T+12 it archives | ☐ |

---

## Batch 5: Things that should NOT fire, and permission edge cases

| ID | Steps | Expected | Result |
|---|---|---|---|
| **5.1** | Create a task for a time **already past** (e.g. an hour ago) | Saves fine. **No** notification. It shows as overdue | ☐ |
| **5.2** | Create a task with **no time** (`clean out my garage`) | No notification at all. It sits under "When you have time" | ☐ |
| **5.3** | Create an event at PLACE for **T+10** (travel + 8 min is more than 10) | **No** time-to-leave notification, since leaving by is already past. The at-the-time one **still** fires at T+10. Today says **Leave now** | ☐ |
| **5.4** | **Notifications off:** Settings -> Notifications -> Aidha (Dev) -> off. Create a task at T+3 | Saves fine, **no crash**, nothing fires. iOS won't re-ask. Turn notifications back on, edit the task to T+4 -> it now fires | ☐ |
| **5.5** | **Location off:** Settings -> Location -> Aidha (Dev) -> **Never**. Create an event at PLACE for T+20 | Saved, with an alert that a "leaving by" reminder **wasn't set up** (couldn't access location). The at-the-time notification still fires. Re-enable location, open the item, and tap the **Leaving by** row ("Tap to set up a reminder") -> a leaving-by time appears | ☐ |
| **5.6** *(optional)* | Schedule a task at T+10, **restart the phone** | Still fires at T+10 | ☐ |

---

## Batch 6: Live Activity (needs S6; about 25 min)

The server starts one as soon as "leaving by" is **within 15 minutes** (it checks every minute). A task
created or recalculated closer than 15 minutes still gets one on the next check; the old rule only
caught a one-minute window and missed those. Each task gets **one**, ever, until it's rescheduled.

Create: event at PLACE for **T+40** (leaving by should land around T+22 to T+27). Check the Leaving by time in the edit screen and write it down: ____. Then **lock the phone** and wait. (Reopening within 90 min of the event recalculates leaving by from your current location, so the Live Activity may start a little earlier or later than you computed. That's fine.)

| ID | What to check | Expected | Result |
|---|---|---|---|
| **6.1** | At leaving by **minus about 15 min** (within a minute or so) | A **Live Activity** appears (lock screen / Dynamic Island): event title, place, "*time* - depart *time*", and a **LEAVE IN** ring counting down. Plus an alert "Time to leave soon" | ☐ |
| **6.2** | The next few minutes | **One** Live Activity only, no duplicates (it's marked started in the database) | ☐ |
| **6.3** | At leaving by | The normal "Time to leave for..." notification | ☐ |
| **6.4** | **Reschedule:** after 6.1, move that event **at least an hour later** and wait for the new window (new leaving by minus about 15 min) | A **second Live Activity** appears for the new time. *Expected side effect:* the first one is not updated or ended, so it may still sit on the lock screen counting down to the old time until iOS removes it. Moving the time by under 5 minutes, or to a time already within 15 minutes, correctly does **not** start another | ☐ |
| **6.5** | **Late creation:** create an event at PLACE for **T+20** (so leaving by is already under 15 min away) | A Live Activity appears **within about a minute**, not never | ☐ |
| **6.6** | Nothing appears at all | Check (a) the item has a **Leaving by** time (not "Unable to calculate"), (b) the `device_push_tokens` row exists, (c) Settings -> Live Activities is on, (d) you're on the **dev** build, not TestFlight (the server currently sends to Apple's sandbox) | ☐ |

---

## Batch 7: Recurring reminders (needs a couple of days)

A repeating item now has a notification that repeats **on its own schedule**. It should keep
firing even if you never complete the item or open the app. These checks need you to wait, so start
them first and check back.

Create these now (use exact clock times):

| Item | Text to type |
|---|---|
| **R1** | `Test R1 every day at T+3` |
| **R2** | `Test R2 every Monday and Thursday at 9am` |
| **R3** | `Test R3 every day at T+5` |
| **R4** | `Test R4 every day at T+7` |

| ID | What to do | Expected | Result |
|---|---|---|---|
| **7.1** | **R1:** Don't complete it. Don't open Aidha. Wait for T+3 today, then again at the same time **tomorrow** | A notification today at T+3 **and again tomorrow at the same time**, with Aidha closed the whole time. (Before this change it would only fire once.) | ☐ |
| **7.2** | **R2:** On the next Monday and Thursday | A "Test R2..." notification at 9:00 on **both** days | ☐ |
| **7.3** | **R3:** After it fires today, mark it done. Check tomorrow | **Exactly one** notification tomorrow at the same time, not two, and not zero. Tomorrow's copy of the task appears in Tasks -> Recurring | ☐ |
| **7.4** | **R4:** Open it before T+7 and **rename** it to `Test R4 renamed`. Check tomorrow's notification | Tomorrow's notification shows the **new** title. (Renaming, changing the location, or changing the repeat rule reschedules the reminder.) | ☐ |
| **7.5** | **R1:** After 7.1, **delete** the task. Check the next day | **No** more notifications | ☐ |
| **7.6** | Change a repeating task's rule: open **R2** -> Recurrence -> **None** -> Save. Check the next Monday | A single reminder at most (for the current occurrence); no weekly repeats | ☐ |
| **7.7** | A repeating task you created **before** this update (if you have one). Open the Today tab once, then check it fires on its next two occurrences | It repeats now; the app upgraded it the first time you opened Today | ☐ |

## Cleanup

Delete the test items: Tasks tab -> open each -> trash. Turn notifications and location back to your normal settings.

## Known behavior (don't report these as bugs)

- **Tapping a notification just opens Aidha.** It doesn't jump to that task.
- **No reminder when an event ends.** Duration affects the Day view and "Happening now", not notifications.
- **iOS keeps at most 64 pending local notifications per app.** Heavy use (recurring tasks plus many events, two notifications each) can drop the furthest-out ones.
- **Reminders live on the phone.** Reinstalling or deleting the app clears them; they're rebuilt as you open and edit items.
- **Leaving by is recalculated when you open the app within 90 minutes of an event**, using where you are then.
- **"Time to leave" reminders don't repeat.** Only the "at the time" reminder does. Leaving by depends on travel time, so it's calculated for the current occurrence only.
- **The 29th-31st of a month, and Feb 29, land on the last day of shorter months.** In a leap-year February they land on the 28th, a day early.
- **Snoozing a repeating item by an hour moves its whole schedule an hour later**, because the schedule follows the item's time.
- **Completing a repeating item doesn't silence tomorrow's reminder.** It hands over to the next occurrence.
- **A Live Activity is never updated or ended after it starts.** Rescheduling, completing or deleting the task leaves the first one on the lock screen with its old time until iOS clears it. Only the *start* is automatic.

## If something fails

Send me: the test ID, what time you created it, what you expected, what happened, and a screenshot of the item's edit screen (it shows "Leaving by"). For 6.x also say whether `device_push_tokens` has a row.
