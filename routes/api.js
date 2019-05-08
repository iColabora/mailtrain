'use strict';

let users = require('../lib/models/users');
let lists = require('../lib/models/lists');
let fields = require('../lib/models/fields');
let blacklist = require('../lib/models/blacklist');
let subscriptions = require('../lib/models/subscriptions');
let confirmations = require('../lib/models/confirmations');
let tools = require('../lib/tools');
let express = require('express');
let log = require('npmlog');
let router = new express.Router();
let mailHelpers = require('../lib/subscription-mail-helpers');

router.all('/*', (req, res, next) => {
    if (!req.query.access_token) {
        res.status(403);
        return res.json({
            error: 'Missing access_token',
            data: []
        });
    }

    users.findByAccessToken(req.query.access_token, (err, user) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!user) {
            res.status(403);
            return res.json({
                error: 'Invalid or expired access_token',
                data: []
            });
        }
        next();
    });

});

router.post('/subscribe/:list', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCidOrName(req.params.list, (err, list) => {
        if (err) {
            log.error('API', err);
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }
        tools.validateEmail(input.EMAIL, false, err => {
            if (err) {
                log.error('API', err);
                res.status(400);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }

            let subscription = {
                email: input.EMAIL
            };

            if (input.FIRST_NAME) {
                subscription.first_name = (input.FIRST_NAME || '').toString().trim();
            }

            if (input.LAST_NAME) {
                subscription.last_name = (input.LAST_NAME || '').toString().trim();
            }

            if (input.TIMEZONE) {
                subscription.tz = (input.TIMEZONE || '').toString().trim();
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                fieldList.forEach(field => {
                    if (input.hasOwnProperty(field.key) && field.column) {
                        subscription[field.column] = input[field.key];
                    } else if (field.options) {
                        for (let i = 0, len = field.options.length; i < len; i++) {
                            if (input.hasOwnProperty(field.options[i].key) && field.options[i].column) {
                                let value = input[field.options[i].key];
                                if (field.options[i].type === 'option') {
                                    value = ['false', 'no', '0', ''].indexOf((value || '').toString().trim().toLowerCase()) >= 0 ? '' : '1';
                                }
                                subscription[field.options[i].column] = value;
                            }
                        }
                    }
                });

                let meta = {
                    partial: true
                };

                if (/^(yes|true|1)$/i.test(input.FORCE_SUBSCRIBE)) {
                    meta.status = 1;
                }

                if (/^(yes|true|1)$/i.test(input.REQUIRE_CONFIRMATION)) {
                    const data = {
                        email: subscription.email,
                        subscriptionData: subscription
                    };

                    confirmations.addConfirmation(list.id, 'subscribe', req.ip, data, (err, confirmCid) => {
                        if (err) {
                            log.error('API', err);
                            res.status(500);
                            return res.json({
                                error: err.message || err,
                                data: []
                            });
                        }

                        mailHelpers.sendConfirmSubscription(list, input.EMAIL, confirmCid, subscription, (err) => {
                            if (err) {
                                log.error('API', err);
                                res.status(500);
                                return res.json({
                                    error: err.message || err,
                                    data: []
                                });
                            }

                            res.status(200);
                            res.json({
                                data: {
                                    id: confirmCid
                                }
                            });
                        });
                    });
                } else {
                    subscriptions.insert(list.id, meta, subscription, (err, response) => {
                        if (err) {
                            log.error('API', err);
                            res.status(500);
                            return res.json({
                                error: err.message || err,
                                data: []
                            });
                        }
                        res.status(200);
                        res.json({
                            data: {
                                id: response.cid
                            }
                        });
                    });
                }
            });
        });
    });
});

router.post('/unsubscribe/:list', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCidOrName(req.params.list, (err, list) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }

        subscriptions.getByEmail(list.id, input.EMAIL, (err, subscription) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }

            if (!subscription) {
                res.status(404);
                return res.json({
                    error: 'Subscription with given email not found',
                    data: []
                });
            }

            subscriptions.changeStatus(list.id, subscription.id, false, subscriptions.Status.UNSUBSCRIBED, (err, found) => {
                if (err) {
                    res.status(500);
                    return res.json({
                        error: err.message || err,
                        data: []
                    });
                }
                res.status(200);
                res.json({
                    data: {
                        id: subscription.id,
                        unsubscribed: true
                    }
                });
            });
        });
    });
});

router.post('/delete/:list', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCidOrName(req.params.list, (err, list) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        if (!input.EMAIL) {
            res.status(400);
            return res.json({
                error: 'Missing EMAIL',
                data: []
            });
        }
        subscriptions.getByEmail(list.id, input.EMAIL, (err, subscription) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }
            if (!subscription) {
                res.status(404);
                return res.json({
                    error: 'Subscription not found',
                    data: []
                });
            }
            subscriptions.delete(list.id, subscription.cid, (err, subscription) => {
                if (err) {
                    res.status(500);
                    return res.json({
                        error: err.message || err,
                        data: []
                    });
                }
                if (!subscription) {
                    res.status(404);
                    return res.json({
                        error: 'Subscription not found',
                        data: []
                    });
                }
                res.status(200);
                res.json({
                    data: {
                        id: subscription.id,
                        deleted: true
                    }
                });
            });
        });
    });
});

router.get('/subscriptions/:list', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);

    lists.getByCidOrName(req.params.list, (err, list) => {
	if (err) {
            res.status(500);
            return res.json({
		error: err.message || err,
		data: []
            });
	}
	subscriptions.list(list.id, start, limit, (err, rows, total) => {
	    if (err) {
		res.status(500);
		return res.json({
		    error: err.message || err,
		    data: []
		});
	    }
	    res.status(200);
	    res.json({
		data: {
		    total: total,
		    start: start,
		    limit: limit,
		    subscriptions: rows
		}
	    });
	});
    });
});

router.get('/lists', (req, res) => {
    lists.quicklist((err, lists) => {
        if (err) {
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        res.status(200);
        res.json({
            data: lists
        });
    });
});


router.post('/lists/add', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toLowerCase()] = (req.body[key] || '').toString().trim();
    });

    if (!(input.name) || (input.name === ''))  {
      res.status(500);
      return res.json({
          error: 'NAME argument are required',
          data: []
      });
    }

	lists.create(input,  (err, id) => {
		if (err || !id) {
		    log.error('API', err);
		    res.status(500);
		    return res.json({
		        error: err.message || err,
		        data: []
		    });
		}
		res.status(200);
		res.json({
		    data: {
		        id
		    }
		});
	});
});

router.get('/list/:id', (req, res) => {
    lists.get(req.params.id, (err, list, status) => {
        res.status(status);
        if (err) {
            return res.json({
                error: err.message || err,
            });
        }
        res.json({
            data: list
        });
    });
});

router.get('/lists/:email', (req, res) => {
    lists.getListsWithEmail(req.params.email, (err, lists) => {
        if (err) {
            res.status(500);
		    return res.json({
		        error: err.message || err,
		        data: []
		    });
        }
        res.status(200);
        res.json({
            data: lists
        });
    });
});

router.post('/field/:list', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCidOrName(req.params.list, (err, list) => {
        if (err) {
            log.error('API', err);
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }

        let field = {
            name: (input.NAME || '').toString().trim(),
            key: (input.KEY || '').toString().trim(),
            description: (input.DESCRIPTION || '').toString().trim(),
            defaultValue: (input.DEFAULT || '').toString().trim() || null,
            type: (input.TYPE || '').toString().toLowerCase().trim(),
            group: Number(input.GROUP) || null,
            groupTemplate: (input.GROUP_TEMPLATE || '').toString().toLowerCase().trim(),
            visible: ['false', 'no', '0', ''].indexOf((input.VISIBLE || '').toString().toLowerCase().trim()) < 0
        };

        fields.create(list.id, field, (err, id, tag) => {
            if (err) {
                res.status(500);
                return res.json({
                    error: err.message || err,
                    data: []
                });
            }
            res.status(200);
            res.json({
                data: {
                    id,
                    tag
                }
            });
        });
    });
});

router.post('/blacklist/add', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAIL) || (input.EMAIL === ''))  {
      res.status(500);
      return res.json({
          error: 'EMAIL argument are required',
          data: []
      });
    }
    blacklist.add(input.EMAIL, (err) =>{
      if (err) {
          res.status(500);
          return res.json({
              error: err.message || err,
              data: []
          });
      }
      res.status(200);
      res.json({
          data: []
      });
    });
});

router.post('/blacklist/delete', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAIL) || (input.EMAIL === ''))  {
      res.status(500);
      return res.json({
          error: 'EMAIL argument are required',
          data: []
      });
    }
    blacklist.delete(input.EMAIL, (err) =>{
      if (err) {
          res.status(500);
          return res.json({
              error: err.message || err,
              data: []
          });
      }
      res.status(200);
      res.json({
          data: []
      });
    });
});

router.get('/blacklist/get', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);
    let search = req.query.search || '';

    blacklist.get(start, limit, search, (err, data, total) => {
      if (err) {
          res.status(500);
          return res.json({
              error: err.message || err,
              data: []
          });
      }
      res.status(200);
      res.json({
          data: {
            total: total,
            start: start,
            limit: limit,
            emails: data
          }
      });
    });
});

router.post('/changeemail/:list', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAILOLD) || (input.EMAILOLD === ''))  {
      res.status(500);
      return res.json({
          error: 'EMAILOLD argument is required',
          data: []
      });
    }
    if (!(input.EMAILNEW) || (input.EMAILNEW === ''))  {
      res.status(500);
      return res.json({
          error: 'EMAILNEW argument is required',
          data: []
      });
    }
    lists.getByCidOrName(req.params.list, (err, list) => {
        if (err) {
            log.error('API', err);
            res.status(500);
            return res.json({
                error: err.message || err,
                data: []
            });
        }
        if (!list) {
            res.status(404);
            return res.json({
                error: 'Selected listId not found',
                data: []
            });
        }
        blacklist.isblacklisted(input.EMAILNEW, (err, blacklisted) =>{
          if (err) {
              res.status(500);
              return res.json({
                  error: err.message || err,
                  data: []
              });
          }
          if (blacklisted) {
            res.status(500);
            return res.json({
                error: 'New email is blacklisted',
                data: []
            });
          }

          subscriptions.getByEmail(list.id, input.EMAILOLD, (err, subscription) => {
              if (err) {
                  res.status(500);
                  return res.json({
                      error: err.message || err,
                      data: []
                  });
              }

              if (!subscription) {
                  res.status(404);
                  return res.json({
                      error: 'Subscription with given old email not found',
                      data: []
                  });
              }

              subscriptions.updateAddressCheck(list, subscription.cid, input.EMAILNEW, null, (err, old, valid) => {
                  if (err) {
                      res.status(500);
                      return res.json({
                          error: err.message || err,
                          data: []
                      });
                  }

                  if (!valid) {
                      res.status(500);
                      return res.json({
                          error: 'New email not valid',
                          data: []
                      });
                  }

                  subscriptions.updateAddress(list.id, subscription.id, input.EMAILNEW, (err) => {
                      if (err) {
                          res.status(500);
                          return res.json({
                              error: err.message || err,
                              data: []
                          });
                      }
                      res.status(200);
                      res.json({
                          data: {
                              id: subscription.id,
                              changedemail: true
                          }
                      });
                  });
              });
          });
        });
    });
});

module.exports = router;
