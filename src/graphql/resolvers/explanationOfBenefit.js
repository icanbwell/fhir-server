const {posts, comments} = require('../fakedata');

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    explanationOfBenefits: async (parent, args, context, info) => { return posts;},
    // eslint-disable-next-line no-unused-vars
    explanationOfBenefit: async (parent, args, context, info) => { return posts[0];},
  },
  ExplanationOfBenefit: {
    // eslint-disable-next-line no-unused-vars
    patient: async (parent, args, context, info) => {
      return comments.filter(x => x.postId === parent.id);
    },
    // eslint-disable-next-line no-unused-vars
    item: async (parent, args, context, info) => {
      return comments.filter(x => x.postId === parent.id);
    },
  },
};
