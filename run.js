const Ga = require('./');
const fs = require('fs');

var runGA = require('commander');

runGA
  .version('0.0.3?')
  .option('-c --config <config file>', 'config')
  .parse(process.argv);

if(!runGA.config||!fs.existsSync(runGA.config)){
  console.error("\n"," error: option `-c --config <config file>' argument or file missing","\n");
  process.exit(1);
}

const config = require('./'+runGA.config);
const ga = new Ga(config,runGA.config);

ga.run().catch(err => console.error(err) );
