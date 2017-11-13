const async = require('async');
const randomExt = require('random-ext');
const rp = require('request-promise');
const { some } = require('bluebird');
const fs = require('fs-extra');

class Ga {

  constructor({ gekkoConfig, stratName, targetValue, populationAmt, parallelqueries, variation, mutateElements, candleValues, getProperties, apiUrl }, configName ) {
    this.configName = configName.replace(/\.js|config\//gi, "");
    this.stratName = stratName;
    this.candleValues = candleValues;
    this.getProperties = getProperties;
    this.apiUrl = apiUrl;
    this.targetValue = targetValue;
    // Check for saved parameters from a previous run
    this.previousBestParams = null;
    this.populationAmt = populationAmt;
    this.parallelqueries = parallelqueries;
    this.variation = variation;
    this.mutateElements = mutateElements;
    this.baseConfig = {
      gekkoConfig: {
        watch: gekkoConfig.watch,
        paperTrader: {
          slippage: 0.05,
          feeTaker: 0.25,
          feeMaker: 0.25,
          feeUsing: 'taker',
          simulationBalance: gekkoConfig.simulationBalance,
          reportRoundtrips: true,
          enabled: true
        },
        writer: {
          enabled: false,
          logpath: ''
        },
        tradingAdvisor: {
          enabled: true,
          method: this.stratName,
          adapter: 'postgresql',
        },
        trader: {
          enabled: false,
        },
        backtest: {
          daterange: gekkoConfig.daterange
        },
        performanceAnalyzer: {
          'riskFreeReturn': 5,
          'enabled': true
        },
        valid: true,
      },
      data: {
        candleProps: ['close', 'start'],
        indicatorResults: false,
        report: true,
        roundtrips: false,
        trades: false
      }
    };


  }

  // Checks for, and if present loads old .json parameters
  async loadBreakPoint() {

    const fileName = `./results/${this.configName}-${this.baseConfig.gekkoConfig.watch.currency}_${this.baseConfig.gekkoConfig.watch.asset}.json`;
    const exists = fs.existsSync(fileName);

    if(exists){

      console.log('Previous config found, loading...');
      return fs.readFile(fileName, 'utf8').then(JSON.parse);

    }

    return false;

  }

  // Allows queued execution via Promise
  queue(items, parallel, ftc) {

    const queued = [];

    return Promise.all(items.map((item) => {

      const mustComplete = Math.max(0, queued.length - parallel + 1);
      const exec = some(queued, mustComplete).then(() => ftc(item));
      queued.push(exec);

      return exec;

    }));

  }

  // Creates a random gene if prop='all', creates one random property otherwise
  createGene(prop) {
    // Is first generation, and previous props available, load them as a start-point
    if (this.previousBestParams === null || this.runstarted) {
      let properties = this.getProperties();
      return prop === 'all' ? properties : properties[prop];
    } else if ( this.previousBestParams.parameters && !this.runstarted) {
      this.runstarted = 1;
      let properties = this.previousBestParams.parameters;
      return prop === 'all' ? properties : properties[prop];
    } else {
      throw Error('Could not resolve a suitable state for previousBestParams');
    }

    //let properties = this.getProperties();
    //console.log(properties);
    //return prop === 'all' ? properties : properties[prop];
  }

  // Creates random population from genes
  createPopulation() {
    let population = [];

    for (let i = 0; i < this.populationAmt; i++) {

      population.push(this.createGene('all'));

    }

    return population;
  }

  // Pairs two parents returning two new childs
  crossover(a, b) {

    let len = Object.keys(a).length;
    let crossPoint = randomExt.integer(len - 1, 1);
    let tmpA = {};
    let tmpB = {};
    let currPoint = 0;

    for (let i in a) {

      if (a.hasOwnProperty(i) && b.hasOwnProperty(i)) {

        if (currPoint < crossPoint) {

          tmpA[i] = a[i];
          tmpB[i] = b[i];

        } else {

          tmpA[i] = b[i];
          tmpB[i] = a[i];

        }

      }

      currPoint++;

    }

    return [tmpA, tmpB];
  }

  // Mutates object a at most maxAmount times
  mutate(a, maxAmount) {

    let amt = randomExt.integer(maxAmount, 0);
    let allProps = Object.keys(a);

    let tmp = {};

    for (let p in a) {

      if (a.hasOwnProperty(p)) {

        tmp[p] = a[p];

      }

    }

    for (let i = 0; i < amt; i++) {

      let position = randomExt.integer(0, a.length);
      let prop = allProps[position];
      tmp[prop] = this.createGene(prop);

    }

    return tmp;
  }

  // For the given population and fitness, returns new population and max score
  runEpoch(population, populationFitness) {

    let selectionProb = [];
    let fitnessSum = 0;
    let maxFitness = [0, 0];

    for (let i = 0; i < this.populationAmt; i++) {

      if (populationFitness[i] > maxFitness[0]) {

        maxFitness = [populationFitness[i], i];

      }

      fitnessSum += populationFitness[i];

    }

    if (fitnessSum === 0) {

      for (let j = 0; j < this.populationAmt; j++) {

        selectionProb[j] = 1 / this.populationAmt;

      }

    } else {

      for (let j = 0; j < this.populationAmt; j++) {

        selectionProb[j] = populationFitness[j] / fitnessSum;

      }

    }

    let newPopulation = [];

    while (newPopulation.length < this.populationAmt * (1 - this.variation)) {

      let a, b;
      let selectedProb = randomExt.float(1, 0);

      for (let k = 0; k < this.populationAmt; k++) {

        selectedProb -= selectionProb[k];

        if (selectedProb <= 0) {

          a = population[k];
          break;

        }

      }
      selectedProb = randomExt.float(1, 0);

      for (let k = 0; k < this.populationAmt; k++) {

        selectedProb -= selectionProb[k];

        if (selectedProb <= 0) {

          b = population[k];
          break;

        }

      }

      let res = this.crossover(this.mutate(a, this.mutateElements), this.mutate(b, this.mutateElements));
      newPopulation.push(res[0]);
      newPopulation.push(res[1]);

    }

    for (let l = 0; l < this.populationAmt * this.variation; l++) {

      newPopulation.push(this.createGene('all'));

    }

    return [newPopulation, maxFitness];
  }

  getConfig(data) {

    const conf = Object.assign({}, this.baseConfig);

    conf.gekkoConfig[this.stratName] = Object.keys(data).reduce((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});

    Object.assign(conf.gekkoConfig.tradingAdvisor, {
      candleSize: data.candleSize,
      historySize: data.historySize
    });

    return conf;

  }

  // Calls api for every element in testSeries and returns gain for each
  async fitnessApi(testsSeries) {

    const numberOfParallelQueries = this.parallelqueries;

    const results = await this.queue(testsSeries, numberOfParallelQueries, async (data) => {

      const outconfig = this.getConfig(data);

      const body = await rp.post({
        url: `${this.apiUrl}/api/backtest`,
        json: true,
        body: outconfig,
        headers: { 'Content-Type': 'application/json' },
        timeout: 900000
      });

      // These properties will be outputted every epoch, remove property if not needed
      const properties = ['balance', 'profit', 'sharpe', 'market', 'relativeProfit', 'yearlyProfit', 'relativeYearlyProfit', 'startPrice', 'endPrice', 'trades'];
      const report = body.report;
      let result = { profit: 0, metrics: false };

      if (report) {

        let picked = properties.reduce((o, k) => {

          o[k] = report[k];

          return o;

        }, {});

        result = { profit: body.report.profit, metrics: picked };

      }

      return result;

    });

    let profits = [];
    let otherMetrics = [];

    for (let i in results) {

      if (results.hasOwnProperty(i)) {

        profits.push(results[i]['profit']);
        otherMetrics.push(results[i]['metrics']);

      }

    }

    return { profits, otherMetrics };

  }

  async run() {

    // Check for old break point
    const loaded_config = await this.loadBreakPoint();
    let population = this.createPopulation();
    let epochNumber = 0;
    let populationFitness;
    let otherPopulationMetrics;
    let allTimeMaximum = {
      parameters: {},
      gain: 0,
      epochNumber: 0,
      otherMetrics: {}
    };

    if (loaded_config) {

      console.log(`Loaded previous config from ${this.configName}-${this.baseConfig.gekkoConfig.watch.currency}_${this.baseConfig.gekkoConfig.watch.asset}.json`);
      this.previousBestParams = loaded_config;

      epochNumber = this.previousBestParams.epochNumber;
      populationFitness = this.previousBestParams.profit;
      otherPopulationMetrics = this.previousBestParams.otherMetrics;
      allTimeMaximum = {
        parameters: this.previousBestParams.parameters,
        gain: this.previousBestParams.gain,
        epochNumber: this.previousBestParams.epochNumber,
        otherMetrics: this.previousBestParams.otherMetrics
      };

      console.log('Resuming previous run...');

    } else {

      console.log('No previous run data, starting from scratch!');

    }

    console.log(`Starting training with: ${this.populationAmt} units`);

    while (allTimeMaximum.gain < this.targetValue) {

      const startTime = new Date().getTime();
      const res = await this.fitnessApi(population);

      populationFitness = res.profits;
      otherPopulationMetrics = res.otherMetrics;

      let endTime = new Date().getTime();
      epochNumber++;
      let results = this.runEpoch(population, populationFitness);
      // console.log(results);
      let newPopulation = results[0];

      let maxResult = results[1];
      let value = maxResult[0];
      let position = maxResult[1];

      if (value >= allTimeMaximum.gain) {

        allTimeMaximum.parameters = population[position];
        allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
        allTimeMaximum.gain = value;
        allTimeMaximum.epochNumber = epochNumber;

      }
      console.log(`
    --------------------------------------------------------------
    Epoch number: ${epochNumber}
    Time it took (seconds): ${(endTime - startTime) / 1000}
    Max profit: ${value} $ max profit position: ${position}
    Max parametars:
    `,
        population[position],
        `
    Other metrics:
    `,
        otherPopulationMetrics[position]);

      // Prints out the whole population with its fitness,
      // useful for finding properties that make no sense and debugging
      // for(let element in population){
      //
      //     console.log('Fitness: '+populationFitness[element]+' Properties:');
      //     console.log(population[element]);
      //
      // }

      console.log(`
    --------------------------------------------------------------
    Global maximum: ${allTimeMaximum.gain} $, parameters:
    `,
        allTimeMaximum.parameters,
        `
    Other metrics of global maximum:
    Global maximum so far:
    `,
        allTimeMaximum.otherMetrics,
        `
    --------------------------------------------------------------
    `);

      // store in json
      const json = JSON.stringify(allTimeMaximum);
      await fs.writeFile(`./results/${this.configName}-${this.baseConfig.gekkoConfig.watch.currency}_${this.baseConfig.gekkoConfig.watch.asset}.json`, json, 'utf8').catch(err => console.log(err) );

      population = newPopulation;

    }

    console.log(`Finished!
  All time maximum:
  ${allTimeMaximum}`);
  }

}


module.exports = Ga;
