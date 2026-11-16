// Rough recipe averages per default serving: grams, protein, carbs, fat, and where a food is
// naturally counted, the weight of one piece. Weights are cooked, served weight.
const foods = [
 ['protein shake|whey protein|whey','scoop',30,24,3,2],
 ['boiled eggs?|eggs?','egg',50,6,0.5,5],
 ['egg whites?','white',33,3.6,0.2,0],
 ['chicken breasts?|grilled chicken','portion',110,34,0,4,110],
 ['chicken tikkas?|tandoori chicken|chicken tikka','portion',110,34,2,7,11],
 ['goat kheema|mutton kheema|goat keema|mutton keema|kheema|keema','portion',100,23,3,12],
 // Cooked, off the bone. A kilo of raw bone-in mutton is nearer 550 g of this.
 ['muttons?|lamb|goat meat|goat','portion',100,25,0,12],
 ['chicken curry pieces|bone-in chicken|chicken pieces','portion',100,27,0,8],
 ['chicken curry|butter chicken','bowl',180,23,9,18],
 ['chicken biryani|biryani','plate',300,24,57,18],
 ['cooked rice|basmati rice|white rice|steamed rice|rice','cup',160,4,45,0.5],
 // Dry rice is measured by the cup far more often than cooked rice is, and a cup of it is
 // three cups cooked, so the two cannot share a row.
 ['dry basmati|raw basmati|dry rice|raw rice|uncooked rice','cup',185,13,144,1.2],
 ['rotis?|chapatis?|phulkas?','roti',40,3,19,1],
 ['parathas?','piece',80,5,34,9],
 ['chana masala|chole|boiled chana|chickpeas|chana','cup',165,14,45,5],
 ['rajma','cup',175,14,37,5],
 ['dal tadka|dals?|lentils','cup',200,12,29,6],
 ['sabzi|mixed vegetables|vegetables','cup',150,4,15,6],
 ['paneer tikka|paneer','portion',100,18,4,22,25],
 ['plain curd|curd|dahi|yogurt','cup',200,7,10,7],
 ['milk','cup',240,8,12,8],
 ['masala chai|milk tea|chai','cup',150,3,6,3],
 ['black tea|black coffee|coffee|tea','cup',240,0,0,0],
 ['sugar','tsp',4,0,4,0],
 ['ghee|cooking oil|oil','tsp',5,0,0,5],
 ['salad','bowl',120,2,8,1],
 ['bananas?','banana',118,1.3,27,0.4],
 ['apples?','apple',180,0.5,25,0.3],
 ['idlis?','piece',50,2,13,0.5],
 ['masala dosa|dosas?','piece',130,6,36,9],
 ['sambar','cup',200,6,17,4],
 ['samosas?','piece',90,5,28,13],
 ['gulab jamuns?','piece',50,2,28,6],
 ['ice cream','scoop',65,2,15,7],
];
const aliases=foods.flatMap(food=>food[0].split('|').map(alias=>({alias,food}))).sort((a,b)=>b.alias.length-a.alias.length);
const words={a:1,an:1,one:1,two:2,three:3,four:4,five:5,half:0.5};
const units='kilograms?|kg|grams?|g|ml|cups?|bowls?|plates?|servings?|portions?|pieces?|scoops?|tbsp|tablespoons?|tsp|teaspoons?';
export function estimate(input){
 const normalized=input.toLowerCase().replace(/\bbalc coffee\b/g,'black coffee').replace(/\bi tsp\b/g,'1 tsp').replace(/(\d)\s*gms?\b/g,'$1 g').replace(/\bhalf (?:a|an)\b/g,'half').replace(/½/g,' 1/2').replace(/¼/g,' 1/4').replace(/¾/g,' 3/4').replace(/\b(\d+)\s+(\d+)\/(\d+)\b/g,(_,n,a,b)=>Number(n)+a/b).replace(/\b(\d+)\/(\d+)\b/g,(_,a,b)=>a/b).replace(/\b(a|an|one|two|three|four|five|half)\b/g,(word)=>words[word]);
 const segments=normalized.split(/[,;+\n]|\b(?:and|with|plus)\b/).map(s=>s.trim()).filter(Boolean);
 const items=[], unknown=[];
 for(const segment of segments){
  const match=aliases.find(({alias})=>new RegExp('\\b'+alias+'\\b').test(segment));
  if(!match){unknown.push(segment);continue}
  const [,unit,grams,p,c,f,pieceGrams]=match.food;
  const amount=segment.match(new RegExp('(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*('+units+')?\\b'));
  const n=amount?Number(amount[1]):1, measure=amount?.[2]||unit;
  const counted=pieceGrams&&unit!=='piece'&&/^pieces?$/.test(measure)?n*pieceGrams:null;
 const mass=counted!==null?counted:/^(kg|kilogram)/.test(measure)?n*1000:/^(g|gram|ml)/.test(measure)?n:null;
  const multiplier=mass!==null?mass/grams:/^(tbsp|tablespoon)/.test(measure)&&unit==='tsp'?n*3:n;
  // Tablespoons are converted to teaspoons to do the sums; the label keeps the user's own unit.
 const shown=/^(tbsp|tablespoon)/.test(measure||'')&&unit==='tsp'?'tbsp':unit;
 const assumption=counted!==null?n+' × piece (~'+Math.round(counted)+' g)':mass!==null?mass+' g'+(measure==='ml'?' (approx. from ml)':''):n+' × '+shown+' (~'+Math.round(multiplier*grams)+' g)';
  items.push({name:segment.match(new RegExp('\\b'+match.alias+'\\b'))[0],assumption,protein:p*multiplier,carbs:c*multiplier,fat:f*multiplier});
  const rest=segment.replace(new RegExp('\\b'+match.alias+'\\b'),'');
  const extra=aliases.find(({alias})=>new RegExp('\\b'+alias+'\\b').test(rest));
  if(extra)unknown.push('Separate foods in “'+segment+'” with commas');
 }
 return {items,unknown};
}
export const energy=({protein,carbs,fat})=>4*protein+4*carbs+9*fat;
export function totals(items){
 return items.reduce((sum,item)=>({protein:sum.protein+item.protein,carbs:sum.carbs+item.carbs,fat:sum.fat+item.fat}),{protein:0,carbs:0,fat:0});
}
