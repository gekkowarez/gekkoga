const async = require('async');
const nodemailer = require('nodemailer');
const randomExt = require('random-ext');
const rp = require('request-promise');
const { some } = require('bluebird');
const fs = require('fs-extra');

class Ga {

  constructor({ gekkoConfig, stratName, mainObjective, populationAmt, parallelqueries, variation, mutateElements, notifications, getProperties, apiUrl }, configName ) {
    this.configName = configName.replace(/\.js|config\//gi, "");
    this.stratName = stratName;
    this.mainObjective = mainObjective;
    this.getProperties = getProperties;
    this.apiUrl = apiUrl;
    this.sendemail = notifications.email.enabled;
    this.senderservice = notifications.email.senderservice;
    this.sender = notifications.email.sender;
    this.senderpass = notifications.email.senderpass;
    this.receiver = notifications.email.receiver;
    this.currency = gekkoConfig.watch.currency;
    this.asset = gekkoConfig.watch.asset;
    this.previousBestParams = null;
    this.populationAmt = populationAmt;
    this.parallelqueries = parallelqueries;
    this.variation = variation;
    this.mutateElements = mutateElements;
    this.baseConfig = {
      gekkoConfig: {
        watch: gekkoConfig.watch,
        paperTrader: {
          slippage: gekkoConfig.slippage,
          feeTaker: gekkoConfig.feeTaker,
          feeMaker: gekkoConfig.feeMaker,
          feeUsing: gekkoConfig.feeUsing,
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

    const fileName = `./results/${this.configName}-${this.currency}_${this.asset}.json`;
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
  runEpoch(population, populationProfits, populationSharpes, populationScores) {
    let selectionProb = [];
    let fitnessSum = 0;
    let maxFitness = [0, 0, 0, 0];

    for (let i = 0; i < this.populationAmt; i++) {

     if (this.mainObjective == 'score') {

       if (populationProfits[i] < 0 && populationSharpes[i] < 0) {

         populationScores[i] = (populationProfits[i] * populationSharpes[i]) * -1;

       } else {

         populationScores[i] = populationProfits[i] * populationSharpes[i];

       }

       if (populationScores[i] > maxFitness[2]) {

         maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i];

       }

     } else if (this.mainObjective == 'profit') {

        if (populationProfits[i] > maxFitness[0]) {

          maxFitness = [populationProfits[i], populationSharpes[i], populationScores[i], i];

        }

      }

      fitnessSum += populationProfits[i];

    }

    if (fitnessSum === 0) {

      for (let j = 0; j < this.populationAmt; j++) {

        selectionProb[j] = 1 / this.populationAmt;

      }

    } else {

      for (let j = 0; j < this.populationAmt; j++) {

        selectionProb[j] = populationProfits[j] / fitnessSum;

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
        timeout: 1200000
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

        result = { profit: body.report.profit, sharpe: body.report.sharpe, metrics: picked };

      }

      return result;

    });

    let scores = [];
    let profits = [];
    let sharpes = [];
    let otherMetrics = [];

    for (let i in results) {

      if (results.hasOwnProperty(i)) {

        scores.push(results[i]['profit'] * results[i]['sharpe']);
        profits.push(results[i]['profit']);
        sharpes.push(results[i]['sharpe']);
        otherMetrics.push(results[i]['metrics']);

      }

    }

    return { scores, profits, sharpes, otherMetrics };

  }

  async run() {
    // Check for old break point
    const loaded_config = await this.loadBreakPoint();
    let population = this.createPopulation();
    let epochNumber = 0;
    let populationScores;
    let populationProfits;
    let populationSharpes;
    let otherPopulationMetrics;
    let allTimeMaximum = {
      parameters: {},
      score: -5,
      profit: -5,
      sharpe: -5,
      epochNumber: 0,
      otherMetrics: {}
    };

    if (loaded_config) {

      console.log(`Loaded previous config from ${this.configName}-${this.currency}_${this.asset}.json`);
      this.previousBestParams = loaded_config;

      epochNumber = this.previousBestParams.epochNumber;
      populationScores = this.previousBestParams.score;
      populationProfits = this.previousBestParams.profit;
      populationSharpes = this.previousBestParams.sharpe;
      otherPopulationMetrics = this.previousBestParams.otherMetrics;
      allTimeMaximum = {
        parameters: this.previousBestParams.parameters,
        score: this.previousBestParams.score,
        profit: this.previousBestParams.profit,
        sharpe: this.previousBestParams.sharpe,
        epochNumber: this.previousBestParams.epochNumber,
        otherMetrics: this.previousBestParams.otherMetrics
      };

      console.log('Resuming previous run...');

    } else {

      console.log('No previous run data, starting from scratch!');

    }

    console.log(`Starting GA with epoch populations of ${this.populationAmt}, running ${this.parallelqueries} units at a time!`);

    while (1) {

      const startTime = new Date().getTime();
      const res = await this.fitnessApi(population);

      populationScores = res.scores;
      populationProfits = res.profits;
      populationSharpes = res.sharpes;
      otherPopulationMetrics = res.otherMetrics;

      let endTime = new Date().getTime();
      epochNumber++;
      let results = this.runEpoch(population, populationProfits, populationSharpes, populationScores);
      let newPopulation = results[0];
      let maxResult = results[1];
      let score = maxResult[2];
      let profit = maxResult[0];
      let sharpe = maxResult[1];
      let position = maxResult[3];

      this.notifynewhigh = false;
      if (this.mainObjective == 'score') {
        if (score >= allTimeMaximum.score) {
            this.notifynewhigh = true;
            allTimeMaximum.parameters = population[position];
            allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
            allTimeMaximum.score = score;
            allTimeMaximum.profit = profit;
            allTimeMaximum.sharpe = sharpe;
            allTimeMaximum.epochNumber = epochNumber;

        }
      } else if (this.mainObjective == 'profit') {
        if (profit >= allTimeMaximum.profit) {
            this.notifynewhigh = true;
            allTimeMaximum.parameters = population[position];
            allTimeMaximum.otherMetrics = otherPopulationMetrics[position];
            allTimeMaximum.score = score;
            allTimeMaximum.profit = profit;
            allTimeMaximum.sharpe = sharpe;
            allTimeMaximum.epochNumber = epochNumber;

        }
      }

      console.log(`
    --------------------------------------------------------------
    Epoch number: ${epochNumber}
    Time it took (seconds): ${(endTime - startTime) / 1000}
    Max score: ${score}
    Max profit: ${profit} ${this.currency}
    Max sharpe: ${sharpe}
    Max profit position: ${position}
    Max parameters:
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
      //     console.log('Fitness: '+populationProfits[element]+' Properties:');
      //     console.log(population[element]);
      //
      // }

      console.log(`
    --------------------------------------------------------------
    Global Maximums:
    Score: ${allTimeMaximum.score}
    Profit: ${allTimeMaximum.profit} ${this.currency}
    Sharpe: ${allTimeMaximum.sharpe}
    parameters: \n\r`,
    allTimeMaximum.parameters,
    `
    Global maximum so far:
    `,
        allTimeMaximum.otherMetrics,
        `
    --------------------------------------------------------------
    `);

      // store in json
      const json = JSON.stringify(allTimeMaximum);
      await fs.writeFile(`./results/${this.configName}-${this.currency}_${this.asset}.json`, json, 'utf8').catch(err => console.log(err) );

      if (this.sendemail && this.notifynewhigh) {
        var transporter = nodemailer.createTransport({
          service: this.senderservice,
          auth: {
            user: this.sender,
            pass: this.senderpass
          }
        });
        var mailOptions = {
          from: this.sender,
          to: this.receiver,
          subject: `Profit: ${allTimeMaximum.profit} ${this.currency}`,
          text: json
        };
        transporter.sendMail(mailOptions, function(error, info){
          if (error) {
            console.log(error);
          } else {
            console.log('Email sent: ' + info.response);
          }
        });
      }


      population = newPopulation;

    }

    console.log(`Finished!
  All time maximum:
  ${allTimeMaximum}`);

  }

}


module.exports = Ga;
