/* =====================================================================
   WILLOW Event System — CONTENT DATA
   Advertising media list, karaoke library, quiz bank, race card,
   music beds, event schedule seed and bingo call nicknames.
   Editable by the venue; operator changes are saved per terminal.
   ===================================================================== */

window.WILLOW_DATA = {

  /* files present in the advertising media folder ------------------ */
  media: [
    { name:'SPONSOR_CARLING_01.JPG',  kind:'JPEG', dwell:12, size:'1.8 MB', plays:412, on:true,  caption:'Pint & a Pie — £7.50 all week' },
    { name:'QUIZNIGHT_PROMO.PNG',     kind:'PNG',  dwell:10, size:'940 KB', plays:388, on:true,  caption:'Friday Quiz Night — 8pm, teams of six' },
    { name:'BINGO_JACKPOT_ROLL.JPG',  kind:'JPEG', dwell:14, size:'2.2 MB', plays:355, on:true,  caption:'Jackpot rolls over to £1,400' },
    { name:'MEMBERS_DRAW_SEP.PNG',    kind:'PNG',  dwell:10, size:'1.1 MB', plays:201, on:true,  caption:'Members Draw — must be present to win' },
    { name:'FUNCTION_HIRE.JPG',       kind:'JPEG', dwell:12, size:'1.6 MB', plays:177, on:false, caption:'Function Suite hire from £120' },
    { name:'KARAOKE_LATE.PNG',        kind:'PNG',  dwell:8,  size:'720 KB', plays:143, on:true,  caption:'Late Karaoke — Thursdays til 1am' },
    { name:'SAFETY_NOTICE.JPG',       kind:'JPEG', dwell:6,  size:'410 KB', plays:96,  on:false, caption:'Please drink responsibly' }
  ],

  /* seed schedule -------------------------------------------------- */
  events: [
    { id:1, date:'2026-08-27', time:'19:00', name:'Thursday Cash Bingo',      room:'Main Hall',      mode:'Bingo',      capacity:220, status:'Live',      notes:'Three books, link Lounge Bar for the £500 house.' },
    { id:2, date:'2026-08-27', time:'21:30', name:'Late Karaoke',             room:'Lounge Bar',     mode:'Karaoke',    capacity:120, status:'Scheduled', notes:'Two mics, singer list opens 21:00.' },
    { id:3, date:'2026-08-28', time:'18:00', name:'Foyer Advertising Loop',   room:'Function Suite', mode:'Ents',       capacity:0,   status:'On Sale',   notes:'Sponsor plates for Q3 partners.' },
    { id:4, date:'2026-08-28', time:'20:00', name:'Friday Quiz Night',        room:'Sports Room',    mode:'Rich Media', capacity:90,  status:'On Sale',   notes:'Eight rounds, teams of six.' },
    { id:5, date:'2026-08-29', time:'19:30', name:'Saturday Prize Bingo',     room:'Main Hall',      mode:'Bingo',      capacity:220, status:'On Sale',   notes:'Link all rooms from game 4.' },
    { id:6, date:'2026-08-29', time:'22:00', name:'At The Races',             room:'Lounge Bar',     mode:'Rich Media', capacity:120, status:'Scheduled', notes:'Six race card, tote on tablets.' },
    { id:7, date:'2026-08-30', time:'15:00', name:'Sunday Family Bingo',      room:'Main Hall',      mode:'BiGD',       capacity:220, status:'Closed',    notes:'Legacy board feed only.' }
  ],

  /* music beds -----------------------------------------------------
     Add src: to play a real file. Paths are relative to the site root
     (e.g. 'media/music/bed01.mp3') or absolute http(s) URLs. Entries
     without src are ignored by the player; picking a folder in Music
     Control replaces this list for the session.                     */
  tracks: [
    { title:'Foyer Bed 01',        artist:'House Selection', time:'3:42' /* , src:'media/music/bed01.mp3' */ },
    { title:'Interval Groove',     artist:'Willow Beds',     time:'2:58' },
    { title:'Warmup Floorfiller',  artist:'Friday Playlist', time:'4:11' },
    { title:'Late Bar Slow',       artist:'House Selection', time:'3:20' },
    { title:'Close Down Theme',    artist:'Willow Beds',     time:'1:44' },
    { title:'Bingo Call Bed',      artist:'Willow Beds',     time:'5:02' }
  ],

  /* karaoke instrumental library. lines[] drive the lyric engine --- */
  songs: [
    { title:'Club Anthem', artist:'House Instrumental', key:'B', lyrics:'Synced', lines:[
      'We came in from the cold outside','Coats on the back of the chair','Somebody put the good song on','And the whole room turned to sing',
      'Hold the note, hold it high','Let the ceiling take the sound','This is where we all belong','Every Friday, same old crowd'] },
    { title:'Northern Soul Revue', artist:'Backing Track', key:'Eb', lyrics:'Synced', lines:[
      'Talcum on the dance floor','Shoes that never sit still','Twelve bars in and I am gone','Spinning like the old days',
      'Keep the beat, keep it steady','Nobody is watching the clock','One more turn around the room','Then the lights come up too soon'] },
    { title:'Saturday Chorus', artist:'Backing Track', key:'G', lyrics:'Synced', lines:[
      'Half a lager, half a promise','Table four is on their feet','Somebody hand me the microphone','I have been waiting all week',
      'Sing it loud, sing it wrong','Nobody minds down here','This is our small famous stage','Same time again next year'] },
    { title:'Slow Dance No.2', artist:'House Instrumental', key:'C', lyrics:'Synced', lines:[
      'Turn the ballroom lights down low','Take my hand, we know the steps','Thirty years of this same tune','And it still says what we mean',
      'Slow now, slow and easy','Let the room go quiet round us','One more verse before the bar shuts','One more turn before we go'] },
    { title:'Bar Room Blues', artist:'Backing Track', key:'A', lyrics:'Synced', lines:[
      'Rain outside on the car park','Neon in the window frame','I have got a voice like gravel','But the crowd sings it just the same',
      'Roll on, roll on, midnight','Nothing waiting for me home','So I will stand up here and holler','Til the landlord calls the last one'] },
    { title:'Last Orders', artist:'House Instrumental', key:'D', lyrics:'Synced', lines:[
      'Bell goes twice behind the pumps','Glasses stacking, coats appearing','Somebody starts the old one up','And nobody wants to leave',
      'Sing it slow, sing it kindly','Arms across the shoulders now','Out into the cold together','Same again next Friday night'] }
  ],

  /* opening singer list -------------------------------------------- */
  singers: [
    { singer:'Marie (table 4)', song:'Club Anthem — House Instrumental' },
    { singer:'Big Dave',        song:'Northern Soul Revue' },
    { singer:'The Hen Party',   song:'Saturday Chorus' },
    { singer:'Ray & Sue',       song:'Slow Dance No.2' }
  ],

  /* quiz bank ------------------------------------------------------ */
  quiz: [
    { q:'Which household appliance was patented in 1901 by Hubert Cecil Booth?', a:['Vacuum cleaner','Toaster','Washing machine','Kettle'], correct:0 },
    { q:'How many players are on the pitch in a full rugby league team?',        a:['Eleven','Thirteen','Fifteen','Seventeen'], correct:1 },
    { q:'Which sea separates Great Britain from Norway?',                        a:['Irish Sea','Baltic Sea','North Sea','Celtic Sea'], correct:2 },
    { q:'What is the chemical symbol for tin?',                                  a:['Ti','Tn','St','Sn'], correct:3 },
    { q:'In darts, what is the highest score from three darts?',                 a:['180','150','171','200'], correct:0 },
    { q:'Which decade did decimal currency arrive in the UK?',                    a:['1950s','1960s','1970s','1980s'], correct:2 },
    { q:'A group of crows is known as a what?',                                   a:['Murder','Parliament','Gaggle','Pride'], correct:0 },
    { q:'How many squares are on a standard chessboard?',                         a:['48','56','64','72'], correct:2 }
  ],

  teams: [
    { name:'The Usual Suspects', score:14 },
    { name:'Nil Points',         score:11 },
    { name:'Quiz Team Aguilera', score:16 },
    { name:'Bar Staff XI',       score:9 },
    { name:'Table Nine',         score:12 }
  ],

  /* race card. form biases the simulated run ----------------------- */
  runners: [
    { name:'Lucky Landlord',  odds:'3/1',  stake:180, color:'#c94f4f', form:1.2 },
    { name:'Bar Tab Bandit',  odds:'5/2',  stake:240, color:'#4f7fc9', form:1.4 },
    { name:'Pie And A Pint',  odds:'7/1',  stake:95,  color:'#c9a24f', form:0.8 },
    { name:'Function Suite',  odds:'9/2',  stake:130, color:'#4fc98a', form:1.0 },
    { name:'Northern Lass',   odds:'11/4', stake:210, color:'#a24fc9', form:1.3 },
    { name:'Last Orders',     odds:'12/1', stake:60,  color:'#c9724f', form:0.6 }
  ],

  /* reporting sample rows (replace with a real export feed) -------- */
  reportRows: [
    { date:'2026-08-21', session:'Thursday Cash Bingo',    mode:'Bingo',      players:186, rooms:2, takings:1420, payout:980 },
    { date:'2026-08-21', session:'Late Karaoke',           mode:'Karaoke',    players:94,  rooms:1, takings:610,  payout:0 },
    { date:'2026-08-22', session:'Friday Quiz Night',      mode:'Rich Media', players:132, rooms:1, takings:880,  payout:300 },
    { date:'2026-08-22', session:'At The Races',           mode:'Rich Media', players:88,  rooms:1, takings:540,  payout:410 },
    { date:'2026-08-23', session:'Saturday Prize Bingo',   mode:'Bingo',      players:214, rooms:4, takings:2380, payout:1650 },
    { date:'2026-08-24', session:'Sunday Family Bingo',    mode:'BiGD',       players:120, rooms:2, takings:760,  payout:520 },
    { date:'2026-08-25', session:'Foyer Advertising Loop', mode:'Ents',       players:0,   rooms:4, takings:450,  payout:0 },
    { date:'2026-08-26', session:'Members Draw',           mode:'Ents',       players:0,   rooms:4, takings:180,  payout:100 }
  ],

  /* traditional bingo calls --------------------------------------- */
  nicknames: {
    1:'Kelly’s eye',2:'One little duck',3:'Cup of tea',4:'Knock at the door',5:'Man alive',6:'Half a dozen',7:'Lucky seven',
    8:'Garden gate',9:'Doctor’s orders',10:'Willow’s den',11:'Legs eleven',13:'Unlucky for some',16:'Sweet sixteen',
    17:'Dancing queen',21:'Key of the door',22:'Two little ducks',25:'Duck and dive',26:'Half a crown',30:'Dirty Gertie',
    33:'All the threes',39:'Those famous steps',40:'Life begins',44:'Droopy drawers',45:'Halfway there',50:'Half a century',
    55:'All the fives',57:'Heinz varieties',59:'The Brighton line',60:'Five dozen',65:'Retirement age',66:'Clickety click',
    68:'Saving grace',72:'Six dozen',76:'Trombones',77:'Sunset strip',80:'Gandhi’s breakfast',83:'Time for tea',
    85:'Staying alive',88:'Two fat ladies',89:'Nearly there',90:'Top of the shop'
  }
};
