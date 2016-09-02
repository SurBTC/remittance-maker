'use strict'

var async = require('async')
var _ = require('lodash')
require('bitcoin-math')
var SurbtcRestClient = require('surbtc-rest-client')

function Maker (options) {
  this.apiKey = '' || 'a061fc555331d1285a89b012676d6e7c'
  this.apiUrl = '' || 'https://stg.surbtc.com/api/v1'
  this.bridgeCurrency = options.bridgeCurrency || 'BTC'
  this.sourceCurrencyDepositFee = options.sourceCurrencyDepositFee || 0
  this.destinationCurrencyWithdrawalFee = options.destinationCurrencyWithdrawalFee || 0.01
  this.dinexFee = options.dinexFee || 0.02
  this.btcInsurance = options.btcInsurance || 0.015
}

Maker.prototype._calculateQuotationFixedSource = function (options, callback) {
  var self = this

  var sourceAmountNoFees = options.sourceAmount
  var destinationAmountNoFees = _.toNumber(options.quotation.quote_balance_change[0])
  var destinationAmountToBeReceived = destinationAmountNoFees * (1 - self.destinationCurrencyWithdrawalFee)
  var marketExchangeRate = destinationAmountNoFees / sourceAmountNoFees
  var sourceCurrencyDepositFeeAmount = sourceAmountNoFees * self.sourceCurrencyDepositFee
  var dinexFeeTotalAmount = (sourceAmountNoFees - sourceCurrencyDepositFeeAmount) * self.dinexFee
  var btcToBuy = _.toNumber(options.reverseQuotation.base_balance_change[0])

  var result = {
    quotation: options.quotation,
    reverseQuotation: options.reverseQuotation,
    marketExchangeRate: marketExchangeRate,
    sourceAmount: options.sourceAmount,
    sourceCurrency: options.sourceCurrency,
    sourceCurrencyDepositFeeAmount: sourceCurrencyDepositFeeAmount,
    dinexFeeTotalAmount: _.round(dinexFeeTotalAmount),
    sourceAmountToBeDeposited: _.round(sourceAmountNoFees / ((1 - self.dinexFee) * (1 - self.sourceCurrencyDepositFee))),
    destinationCurrency: options.destinationCurrency,
    destinationAmountNoFees: destinationAmountNoFees,
    destinationAmountToBeReceived: _.round(destinationAmountToBeReceived, 2),
    btcToBuy: btcToBuy
  }

  return callback(null, {success: true, quotation: result})
}

Maker.prototype._calculateQuotationFixedDestination = function (options, callback) {
  var self = this

  var sourceAmountNoFees = _.toNumber(options.quotation.quote_balance_change[0]) * (-1)
  var destinationAmountNoFees = options.reverseQuotation.quote_balance_change[0]
  var destinationAmountToBeReceived = options.destinationAmount * (1 - self.destinationCurrencyWithdrawalFee)
  var marketExchangeRate = destinationAmountNoFees / sourceAmountNoFees
  var sourceAmountPlusDepositFee = sourceAmountNoFees / (1 - self.sourceCurrencyDepositFee)
  var sourceAmountPlusDepositFeeAndDinexFee = sourceAmountPlusDepositFee / (1 - self.dinexFee)
  var dinexFeeTotalAmount = _.toInteger(sourceAmountPlusDepositFeeAndDinexFee - sourceAmountPlusDepositFee)
  var sourceCurrencyDepositFeeAmount = _.toInteger(sourceAmountPlusDepositFee - sourceAmountNoFees)
  var btcToBuy = _.toNumber(options.reverseQuotation.base_balance_change[0]) * (-1)

  var result = {
    quotation: options.quotation,
    reverseQuotation: options.reverseQuotation,
    marketExchangeRate: marketExchangeRate,
    sourceAmount: sourceAmountNoFees,
    sourceCurrency: options.sourceCurrency,
    sourceCurrencyDepositFeeAmount: sourceCurrencyDepositFeeAmount,
    sourceAmountPlusDepositFee: sourceAmountPlusDepositFee,
    dinexFeeTotalAmount: _.round(dinexFeeTotalAmount),
    sourceAmountToBeDeposited: _.round(sourceAmountPlusDepositFeeAndDinexFee),
    destinationCurrency: options.destinationCurrency,
    destinationAmountNoFees: destinationAmountNoFees,
    destinationAmountToBeReceived: _.round(destinationAmountToBeReceived, 2),
    btcToBuy: btcToBuy
  }

  return callback(null, {success: true, quotation: result})
}

Maker.prototype.quoteRemittanceFixedSource = function (options, callback) {
  var self = this

  var client = new SurbtcRestClient({
    api: self.apiUrl,
    secret: self.apiKey
  })

  if (!options.sourceCurrency) {
    return callback({success: false, error_type: 'sourceCurrency_required', statusCode: 400}, null)
  }

  if (!(options.sourceAmount && _.isFinite(options.sourceAmount))) {
    return callback({success: false, error_type: 'sourceAmount_invalid', statusCode: 400}, null)
  }

  if (options.sourceCurrency === 'CLP') {
    var marketId = 'BTC-CLP'
    var type = 'Bid'
    var reverseMarket = 'BTC-COP'
    var reverseType = 'Ask'
    // convert source amount to amount minus dinex fee
    options.sourceAmount = _.toInteger(options.sourceAmount) * (1 - self.sourceCurrencyDepositFee) * (1 - self.dinexFee)
    // set destination currency
    options.destinationCurrency = 'COP'
    // get exchange fee
    async.waterfall([
      function (next) {
        client.getReverseQuotation(marketId, type, options.sourceAmount, next)
      },
      function (reverseQuotation, next) {
        options.reverseQuotation = reverseQuotation.quotation
        options.reverseQuotationAmountPlusInsurance = _.toNumber(options.reverseQuotation.base_balance_change[0]) * (1 - self.btcInsurance)
        client.getQuotation(reverseMarket, reverseType, options.reverseQuotationAmountPlusInsurance, next)
      },
      function (quotation, next) {
        options.quotation = quotation.quotation
        self._calculateQuotationFixedSource(options, next)
      }
    ], callback)
  } else {
    return callback({success: false, error_type: 'sourceCurrency_invalid', statusCode: 400}, null)
  }
}

Maker.prototype.quoteRemittanceFixedDestination = function (options, callback) {
  var self = this

  var client = new SurbtcRestClient({
    api: self.apiUrl,
    secret: self.apiKey
  })

  if (!options.destinationCurrency) {
    return callback({success: false, error_type: 'destinationCurrency_required', statusCode: 400}, null)
  }

  if (!(options.destinationAmount && _.isFinite(options.destinationAmount))) {
    return callback({success: false, error_type: 'destinationAmount_invalid', statusCode: 400}, null)
  }

  if (options.destinationCurrency === 'COP') {
    var marketId = 'BTC-COP'
    var type = 'Ask'
    var reverseMarket = 'BTC-CLP'
    var reverseType = 'Bid'
    // force destinationAmount as number
    options.destinationAmount = _.toNumber(options.destinationAmount)
    // include withdrawal fee
    options.destinationAmount = options.destinationAmount / (1 - self.destinationCurrencyWithdrawalFee)
    // set source currency
    options.sourceCurrency = 'CLP'
    // get exchange fee
    async.waterfall([
      function (next) {
        client.getReverseQuotation(marketId, type, options.destinationAmount, next)
      },
      function (reverseQuotation, next) {
        options.reverseQuotation = reverseQuotation.quotation
        options.reverseQuotationAmountPlusInsurance = _.toNumber(options.reverseQuotation.base_balance_change[0]) / (self.btcInsurance - 1)
        client.getQuotation(reverseMarket, reverseType, options.reverseQuotationAmountPlusInsurance, next)
      },
      function (quotation, next) {
        options.quotation = quotation.quotation
        self._calculateQuotationFixedDestination(options, next)
      }
    ], callback)
  } else {
    return callback({success: false, error_type: 'destinationCurrency_invalid', statusCode: 400}, null)
  }
}

Maker.prototype.executeRemittance = function (options, callback) {
  var self = this

  var client = new SurbtcRestClient({
    api: self.apiUrl,
    secret: self.apiKey
  })

  if (!(options.btcAmount && _.isFinite(options.btcAmount))) {
    return callback({success: false, error_type: 'btcAmount_invalid', statusCode: 400}, null)
  }

  if (!options.destinationCurrency) {
    return callback({success: false, error_type: 'destinationCurrency_required', statusCode: 400}, null)
  }

  if (options.destinationCurrency === 'COP') {
    // market buy of BTC
    // convert btcAmount to satoshis
    var amnt = options.btcAmount.toSatoshi()
    var buyOrder = {
      type: 'bid',
      limit: null,
      amount: amnt,
      price_type: 'market'
    }

    // market sell of BTC
    var sellOrder = {
      type: 'ask',
      limit: null,
      amount: null,
      price_type: 'market'
    }

    async.waterfall([
      function (next) {
        client.createAndTradeOrder('btc-clp', buyOrder, function (err, res) {
          if (err) {
            return callback({success: false, error: err, statusCode: 500}, null)
          } else {
            // set sellOrder.amount based on res
            sellOrder.amount = _.toNumber(res.order.traded_amount)
            // store res
            buyOrder.tradedOrder = res.order
            next()
          }
        })
      },
      function (next) {
        client.createAndTradeOrder('btc-cop', sellOrder, function (err, res) {
          if (err) {
            // sell back??
            callback({success: false, error: err, statusCode: 500}, null)
          } else {
            // store res
            sellOrder.tradedOrder = res.order
            callback(null, {success: true, buyOrder: buyOrder, sellOrder: sellOrder, statusCode: 200})
          }
        })
      }
    ], callback)
  } else {
    return callback({success: false, error_type: 'destinationCurrency_invalid', statusCode: 400}, null)
  }
}

module.exports = Maker
