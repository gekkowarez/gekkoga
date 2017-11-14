const randomExt = require('random-ext');

const config = {
  gekkoConfig: {
    watch: {
      exchange: 'poloniex',
      currency: 'USDT',
      asset: 'BTC'
    },
    //daterange: 'scan',
    daterange: {
      from: '2017-07-01 00:00',
      to: '2017-09-07 00:00'
    },
    simulationBalance: {
      'asset': 1,
      'currency': 1
    },
    slippage: 0.05,
    feeTaker: 0.25,
    feeMaker: 0.25,
    feeUsing: 'taker', // maker || taker
  },
  apiUrl: 'http://localhost:3000',
  // Population size, better reduce this for larger data
  populationAmt: 50,
  // How many completely new units will be added to the population (Population * variation must be a whole number!!)
  variation: 0.2,
  // How many components maximum to mutate at once
  mutateElements: 4,
  // How many parallel queries to run at once
  parallelqueries: 10,
  /*
   When the algorithm reaches this value it will stop,
   but you can stop it any time you wish since the last max parameters are outputted every epoch
   */
  targetValue: 5000000000,
  stratName: 'MACD',
  candleValues: [5,15,30,60,120,240],
  getProperties: () => ({
    // Here add the indicators and the ranges you want to handle
    // In this case my strategy wants to test RSI and MACD ranges
    historySize: randomExt.integer(100, 20),
    short: 10,
    long: 21,
    signal: 9,
    thresholds: {
      up: randomExt.float(20,0).toFixed(2),
      down: randomExt.float(0,-20).toFixed(2),
    },
    candleSize: config.candleValues[randomExt.integer(config.candleValues.length -1, 0)]
  })
};

module.exports = config;
