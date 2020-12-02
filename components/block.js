polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),
  timezone: Ember.computed('Intl', function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  maxRelatedToShow: 50,
  showRelated: false,
  numRelatedIpsShown: 0,

  init() {
    this.set(
      'numRelatedIpsShown',
      Math.min(this.get('maxRelatedToShow'), this.get('details.similarIPs.ips.length'))
    );

    this._super(...arguments);
  },
  actions: {
    toggleShowRelated: function () {
      this.toggleProperty(`showRelated`);
      this.get('block').notifyPropertyChange('data');
    }
  }
});
