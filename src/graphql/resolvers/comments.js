const {posts, comments} = require('../fakedata');

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    comments: async (parent, args, context, info) => { return comments;},
    // eslint-disable-next-line no-unused-vars
    comment: async (parent, args, context, info) => { return comments[0];},
  },
  Comment: {
      // eslint-disable-next-line no-unused-vars
    post: async (parent, args, context, info) => {
      return posts.filter(x => x.id === parent.postId)[0];
    },
  },
};

