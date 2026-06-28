'use strict';

window.HistoryStoreContract = {
  dbName: 'ecom-ai-tools-history',
  dbVersion: 1,
  stores: {
    records: 'historyRecords',
    actions: 'historyActions'
  },
  statuses: ['candidate', 'review', 'verified', 'rejected', 'generated', 'pending_review', 'distributed']
};
